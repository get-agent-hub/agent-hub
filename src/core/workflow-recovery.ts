import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { ensureBaseline, readBaseline, recordExpectedWrites } from './baseline.js';
import { readArtifactBaseline, recordArtifactWrites } from './artifact-recovery.js';
import { inspectTree } from './recovery-tree.js';
import { inspectArtifact } from './artifacts.js';
import { snapshot, writeAtomic, readOptionalText } from './file-store.js';
import { withHubLock } from './hub-lock.js';
import { mirrorRecoveryWrites, withRecoveryStorage } from './recovery-storage.js';
import { recoveryRoot } from './recovery-paths.js';
import { planReset, applyReset, publicResetPlan } from './reset.js';
import { HubError } from './errors.js';
import { hash, stableStringify } from './values.js';
import { hubCommand } from './shell.js';
import { hubRoot } from './paths.js';

const runId = /^run-\d{4}-\d{2}-\d{2}T[\d-]+Z-[a-f0-9]{12}$/;
const runsDirectory = (root: string) => path.join(recoveryRoot(root), 'runs');
const command = (root: string, args: string[]) =>
  hubCommand(
    {
      root,
      node: process.execPath,
      cli: fileURLToPath(new URL('../../dist/cli.js', import.meta.url)),
    },
    args,
  );

async function evidence(root: string) {
  const baseline = await readBaseline(root);
  const artifacts = await readArtifactBaseline(root);
  return {
    hub: (await inspectTree(root)).fingerprint,
    files: await Promise.all(
      (baseline?.files ?? []).map(async (file) => {
        const current = await snapshot(file.file);
        return {
          file: current.file,
          realFile: current.realFile,
          mode: current.mode,
          hash: hash(current.content),
        };
      }),
    ),
    artifacts: await Promise.all(
      artifacts.entries.map(async (entry) => {
        const current = await inspectArtifact(entry.before.path);
        return {
          path: current.path,
          physicalPath: current.physicalPath,
          fingerprint: current.fingerprint,
        };
      }),
    ),
  };
}
type Run = {
  version: 1;
  root: string;
  id: string;
  scope: string;
  state: 'recording' | 'complete' | 'partial' | 'undone';
  after?: Awaited<ReturnType<typeof evidence>>;
};

/** Snapshot this run before its first write, mirroring the existing first-touch engines. */
export async function withWorkflowRecovery<T>(
  root: string,
  scope: string,
  validate: () => Promise<void>,
  action: () => Promise<T>,
) {
  return withHubLock(
    root,
    async (_firstOrigin, currentOrigin) => {
      await validate();
      const id = `run-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomBytes(6).toString('hex')}`;
      const directory = path.join(runsDirectory(root), id);
      await fs.mkdir(directory, { recursive: true, mode: 0o700 });
      const manifest = path.join(directory, 'run.json');
      const run: Run = { version: 1, root: path.resolve(root), id, scope, state: 'recording' };
      const save = () => writeAtomic(manifest, JSON.stringify(run, null, 2) + '\n', 0o600);
      await save();
      await withRecoveryStorage(root, directory, () => ensureBaseline(root, [], currentOrigin));
      let result: T;
      try {
        result = await mirrorRecoveryWrites(root, directory, action);
        run.state = 'complete';
      } catch (error) {
        run.state = 'partial';
        run.after = await withRecoveryStorage(root, directory, () => evidence(root));
        await save();
        throw error;
      }
      run.after = await withRecoveryStorage(root, directory, () => evidence(root));
      await save();
      return { ...result, run: id, undoCommand: command(root, ['undo', id]) };
    },
    { createHub: false },
  );
}

async function readRun(root: string, requested: string) {
  const runs = runsDirectory(root);
  const parent = await inspectArtifact(runs);
  if (parent.kind !== 'directory')
    throw new HubError(
      'No workflow snapshots are available. Only new quick and project connect runs record undo snapshots.',
    );
  const ids =
    requested === 'latest'
      ? (await fs.readdir(runs))
          .filter((id) => runId.test(id))
          .sort()
          .reverse()
      : [requested];
  if (!ids.length || ids.some((id) => !runId.test(id)))
    throw new HubError('Choose a recorded workflow run ID or latest.');
  for (const id of ids) {
    const directory = path.join(runs, id);
    if (
      (await inspectArtifact(directory)).kind !== 'directory' ||
      (await inspectArtifact(path.join(directory, 'run.json'))).kind !== 'file'
    )
      throw new HubError('Workflow snapshot must use real private storage.');
    let run: Run;
    try {
      run = JSON.parse((await readOptionalText(path.join(directory, 'run.json')))!);
      if (
        run.version !== 1 ||
        run.root !== path.resolve(root) ||
        run.id !== id ||
        !['hub', 'project'].includes(run.scope) ||
        !['recording', 'complete', 'partial', 'undone'].includes(run.state)
      )
        throw new Error();
    } catch {
      throw new HubError('Workflow metadata is invalid. No files were changed.');
    }
    if (requested === 'latest' && run.state === 'undone') continue;
    if (run.state === 'undone') throw new HubError('This workflow was already undone.');
    if (run.state === 'recording' || !run.after)
      throw new HubError(
        'This workflow did not finish recording. Inspect recovery data and preview ahub reset instead.',
      );
    return { run, directory };
  }
  throw new HubError('All recorded workflows have already been undone.');
}

export async function planUndo(requested = 'latest', root = hubRoot(), ownPid?: number) {
  const { run, directory } = await readRun(root, requested);
  return withRecoveryStorage(root, directory, async () => {
    const reset = await planReset({}, root, ownPid);
    const current = await evidence(root);
    const changedAfterRun = stableStringify(current) !== stableStringify(run.after);
    return {
      root,
      run,
      directory,
      reset,
      changedAfterRun,
      blocked: reset.blocked || changedAfterRun,
      revision: hash(stableStringify({ run, reset: reset.revision, current })),
    };
  });
}
export function publicUndoPlan(plan: Awaited<ReturnType<typeof planUndo>>) {
  const reset = publicResetPlan(plan.reset);
  return {
    run: plan.run.id,
    scope: plan.run.scope,
    revision: plan.revision,
    blocked: plan.blocked,
    changedAfterRun: plan.changedAfterRun,
    changed: plan.reset.changed,
    note: plan.changedAfterRun
      ? 'Later Hub or client changes prevent workflow undo. Preserve that work and use individual restore or review reset.'
      : 'Restore the state immediately before this workflow. Current data is archived; the first baseline remains available.',
    hub: reset.hub,
    paths: reset.files,
    directories: reset.directories,
    locks: reset.locks,
    commands: {
      dryRun: command(plan.root, ['undo', plan.run.id]),
      apply: command(plan.root, ['undo', plan.run.id, '--apply', '--expect', plan.revision]),
    },
  };
}

/** Reconcile the canonical first-baseline journals with this Hub-owned reverse write. */
async function recordRestoredState(root: string) {
  const baseline = await readBaseline(root);
  await recordExpectedWrites(
    root,
    await Promise.all(
      (baseline?.files ?? []).map(async (file) => {
        const before = await snapshot(file.file);
        return { before, after: before.content };
      }),
    ),
  );
  const artifacts = await readArtifactBaseline(root);
  await recordArtifactWrites(
    root,
    await Promise.all(
      artifacts.entries.map(async (entry) => {
        const before = await inspectArtifact(entry.before.path);
        return {
          before,
          source: before.kind === 'missing' ? null : before.path,
          rollbackSource: before.kind === 'missing' ? null : before.path,
          afterFingerprint: before.fingerprint,
        };
      }),
    ),
    false,
  );
}
export async function applyUndo(plan: Awaited<ReturnType<typeof planUndo>>, expect: string) {
  if (expect !== plan.revision || plan.blocked)
    throw new HubError('Undo requires an unblocked exact reviewed revision.');
  return withHubLock(
    plan.root,
    async () => {
      const fresh = await planUndo(plan.run.id, plan.root, process.pid);
      if (fresh.blocked || fresh.revision !== expect)
        throw new HubError('State changed since the undo preview. Review a new plan.');
      const result = await withRecoveryStorage(plan.root, plan.directory, () =>
        applyReset(fresh.reset, fresh.reset.revision),
      );
      await recordRestoredState(plan.root);
      await writeAtomic(
        path.join(plan.directory, 'run.json'),
        JSON.stringify({ ...plan.run, state: 'undone' }, null, 2) + '\n',
        0o600,
      );
      return { ...result, run: plan.run.id };
    },
    { createHub: false },
  );
}
