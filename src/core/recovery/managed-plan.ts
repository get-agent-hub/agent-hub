import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  containsPath,
  copyArtifact,
  inspectArtifact,
  sameArtifact,
  writeArtifactTransaction,
  type ArtifactChange,
  type ArtifactSnapshot,
} from '../../shared/artifacts.js';
import { HubError } from '../../shared/errors.js';
import { withHubLock } from '../../shared/hub-lock.js';
import { cliPath } from '../../shared/runtime.js';
import { hubCommand } from '../../shared/shell.js';
import { hash, stableStringify } from '../../shared/values.js';
import {
  ensureArtifactBaseline,
  readArtifactBaseline,
  recordArtifactWrites,
} from './artifact-recovery.js';
import { ensureBaseline, readBaseline } from './baseline.js';
import { revokeAutomationCheckpoints } from './checkpoint-authority.js';

export type ArtifactValue =
  | { kind: 'file'; content: string; mode: number }
  | { kind: 'symlink'; target: string }
  | { kind: 'copy'; source: ArtifactSnapshot }
  | { kind: 'missing' };
export interface ArtifactRequest {
  before: ArtifactSnapshot;
  value: ArtifactValue;
  client: string;
}
export interface ManagedRow {
  path: string;
  client: string;
  name: string;
  action: 'add' | 'replace' | 'remove' | 'keep' | 'preserve' | 'skip' | 'conflict';
  note?: string;
}
export interface ManagedPlan {
  root: string;
  revision: string;
  blocked: boolean;
  rows: ManagedRow[];
  requests: ArtifactRequest[];
  sources: ArtifactSnapshot[];
  command: string[];
}

export function managedPlan(
  input: Omit<ManagedPlan, 'revision' | 'blocked'>,
  inputs: unknown = {},
): ManagedPlan {
  const overlapping = input.requests.some((request, index) =>
    input.requests
      .slice(0, index)
      .some(
        (other) =>
          containsPath(other.before.physicalPath, request.before.physicalPath) ||
          containsPath(request.before.physicalPath, other.before.physicalPath),
      ),
  );
  const sourceOverlap = input.requests.some((request) =>
    input.sources.some(
      (source) =>
        containsPath(request.before.physicalPath, source.physicalPath) ||
        containsPath(source.physicalPath, request.before.physicalPath),
    ),
  );
  const rows =
    overlapping || sourceOverlap
      ? [
          ...input.rows,
          {
            path: input.root,
            client: 'hub',
            name: '*',
            action: 'conflict' as const,
            note: 'Managed paths overlap each other or a source; separate them before applying.',
          },
        ]
      : input.rows;
  return {
    ...input,
    rows,
    revision: hash(stableStringify({ ...input, inputs })),
    blocked: rows.some((row) => row.action === 'conflict'),
  };
}

export function publicManagedPlan(plan: ManagedPlan) {
  const context = {
    root: plan.root,
    node: process.execPath,
    cli: cliPath,
  };
  return {
    revision: plan.revision,
    blocked: plan.blocked,
    rows: plan.rows,
    changes: plan.requests.length,
    commands: {
      dryRun: hubCommand(context, [...plan.command, '--dry-run']),
      apply: hubCommand(context, [...plan.command, '--apply', '--expect', plan.revision]),
    },
  };
}

export async function prepareArtifacts(
  directory: string,
  requests: ArtifactRequest[],
): Promise<ArtifactChange[]> {
  const changes: ArtifactChange[] = [];
  for (const [index, request] of requests.entries()) {
    const rollbackSource =
      request.before.kind === 'missing' ? null : path.join(directory, `before-${index}`);
    if (rollbackSource) await copyArtifact(request.before.path, rollbackSource);
    const source = request.value.kind === 'missing' ? null : path.join(directory, `after-${index}`);
    if (source) {
      const value = request.value;
      if (value.kind === 'file') {
        await fs.writeFile(source, value.content, { flag: 'wx', mode: value.mode });
        await fs.chmod(source, value.mode);
      } else if (value.kind === 'symlink') await fs.symlink(value.target, source);
      else if (value.kind === 'copy') {
        if (!sameArtifact(value.source, await inspectArtifact(value.source.path)))
          throw new HubError('Source changed since preview.');
        await copyArtifact(value.source.path, source);
      }
    }
    const afterFingerprint = (await inspectArtifact(source ?? path.join(directory, '.absent-node')))
      .fingerprint;
    changes.push({ before: request.before, source, afterFingerprint, rollbackSource });
  }
  return changes;
}

export async function applyManagedPlan(
  plan: ManagedPlan,
  rebuild: () => Promise<ManagedPlan>,
  expect?: string,
) {
  if (expect !== plan.revision)
    throw new HubError('Apply requires --expect from the reviewed dry run.');
  if (plan.blocked) throw new HubError('The plan is blocked by conflicts. Review the dry run.');
  if (!plan.requests.length) return { changedPaths: 0, backup: null, restoreCommand: null };
  return withHubLock(plan.root, async (origin) => {
    const fresh = await rebuild();
    if (fresh.revision !== plan.revision || fresh.blocked)
      throw new HubError('Inputs changed since preview. Review a new dry run.');
    if (fresh.command[0] === 'restore') await revokeAutomationCheckpoints(plan.root);
    await ensureBaseline(plan.root, [], origin);
    await ensureArtifactBaseline(plan.root, fresh.requests);
    const id = `content-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomBytes(4).toString('hex')}`;
    const directory = path.join(plan.root, 'backups', id);
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    const changes = await prepareArtifacts(directory, fresh.requests);
    await fs.writeFile(
      path.join(directory, 'manifest.json'),
      JSON.stringify(
        {
          version: 1,
          root: plan.root,
          changes: changes.map((change, index) => ({
            before: change.before,
            client: fresh.requests[index]!.client,
            afterFingerprint: change.afterFingerprint,
            payload: change.rollbackSource ? path.basename(change.rollbackSource) : null,
          })),
        },
        null,
        2,
      ),
      { flag: 'wx', mode: 0o600 },
    );
    await recordArtifactWrites(plan.root, changes);
    try {
      await writeArtifactTransaction(
        changes,
        undefined,
        async () => {
          for (const snapshot of fresh.sources)
            if (!sameArtifact(snapshot, await inspectArtifact(snapshot.path)))
              throw new HubError('Source changed during application.');
        },
        () => recordArtifactWrites(plan.root, changes, false),
      );
    } catch (error) {
      throw new HubError(
        `${error instanceof HubError ? error.message : 'Content update failed.'} Backup: ${id}.`,
        { cause: error },
      );
    }
    const context = {
      root: plan.root,
      node: process.execPath,
      cli: cliPath,
    };
    return {
      changedPaths: changes.length,
      backup: id,
      restoreCommand: hubCommand(context, ['restore', id, '--dry-run']),
    };
  });
}

export async function planManagedRestore(id: string, root: string): Promise<ManagedPlan> {
  if (!/^content-[\w-]+$/.test(id)) throw new HubError('Invalid content backup ID.');
  const directory = path.join(root, 'backups', id);
  const baseline = await readArtifactBaseline(root);
  const fileBaseline = await readBaseline(root);
  let manifest;
  try {
    manifest = JSON.parse(await fs.readFile(path.join(directory, 'manifest.json'), 'utf8')) as {
      version: number;
      root: string;
      changes: {
        before: ArtifactSnapshot;
        client: string;
        afterFingerprint: string;
        payload: string | null;
      }[];
    };
    if (manifest.version !== 1 || manifest.root !== root || !Array.isArray(manifest.changes))
      throw new Error();
  } catch {
    throw new HubError('Cannot read content backup manifest.');
  }
  const rows: ManagedRow[] = [];
  const requests: ArtifactRequest[] = [];
  const sources: ArtifactSnapshot[] = [];
  for (const entry of manifest.changes) {
    if (
      !entry.before ||
      !path.isAbsolute(entry.before.path) ||
      !path.isAbsolute(entry.before.physicalPath) ||
      !/^[a-f0-9]{64}$/.test(entry.before.fingerprint) ||
      typeof entry.client !== 'string' ||
      (entry.payload === null) !== (entry.before.kind === 'missing') ||
      !/^[a-f0-9]{64}$/.test(entry.afterFingerprint) ||
      (entry.payload !== null && !/^before-\d+$/.test(entry.payload)) ||
      (!containsPath(root, entry.before.path) &&
        !baseline.entries.some((original) => original.before.path === entry.before.path) &&
        !fileBaseline?.files.some((original) => original.file === entry.before.path))
    )
      throw new HubError('Content backup target is not a recorded managed path.');
    const current = await inspectArtifact(entry.before.path);
    const original = entry.payload
      ? await inspectArtifact(path.join(directory, entry.payload))
      : undefined;
    if (original && original.fingerprint !== entry.before.fingerprint)
      throw new HubError('Content backup failed its integrity check.');
    const conflict =
      current.physicalPath !== entry.before.physicalPath ||
      current.fingerprint !== entry.afterFingerprint;
    rows.push({
      path: current.path,
      client: entry.client,
      name: path.basename(current.path),
      action: conflict ? 'conflict' : 'replace',
      note: conflict ? 'Changed after this backup; preserved.' : 'Restore this recorded original.',
    });
    requests.push({
      before: current,
      client: entry.client,
      value: original ? { kind: 'copy', source: original } : { kind: 'missing' },
    });
    if (original) sources.push(original);
  }
  return managedPlan({ root, rows, requests, sources, command: ['restore', id] });
}
