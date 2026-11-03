import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { HubError } from './errors.js';
import { hubRoot } from './paths.js';
import {
  readBaseline,
  verifyBaseline,
  originalContent,
  readExpectedWrites,
  recordExpectedWrites,
  baselineDirectory,
} from './baseline.js';
import { inspectTree, copyTree } from './recovery-tree.js';
import { recoveryRoot } from './recovery-paths.js';
import { inspectLocks, recoverLocks, withHubLock } from './hub-lock.js';
import { snapshot, writeAtomic } from './file-store.js';
import { writeTransaction } from './file-transaction.js';
import { hash, stableStringify } from './values.js';
import { hubCommand } from './shell.js';
import { fileURLToPath } from 'node:url';
import { planArtifactReset, recordArtifactWrites } from './artifact-recovery.js';
import { inspectArtifact, writeArtifactTransaction, type ArtifactChange } from './artifacts.js';
import { prepareArtifacts } from './managed-plan.js';

export interface ResetOptions {
  archiveChanges?: boolean;
  recoverLock?: boolean;
}

export async function planReset(options: ResetOptions = {}, root = hubRoot(), ownPid?: number) {
  root = path.resolve(root);
  const baseline = await readBaseline(root);
  if (!baseline)
    throw new HubError(
      'No original baseline was recorded. State before earlier hub runs cannot be reconstructed. The next managed write will capture an existing-hub checkpoint.',
    );
  await verifyBaseline(root, baseline);
  const expected = await readExpectedWrites(root);
  const hub = await inspectTree(root);
  const artifacts = await planArtifactReset(root, options.archiveChanges === true);
  const locks = await inspectLocks(root);
  const files = await Promise.all(
    baseline.files.map(async (file) => {
      const current = await snapshot(file.file);
      const original = await originalContent(root, file);
      const changed =
        current.content !== original || (current.content !== null && current.mode !== file.mode);
      const bindingChanged = current.realFile !== file.realFile;
      const intent = expected.files[file.file];
      const outsideChanges =
        changed &&
        (!intent?.hashes.includes(hash(current.content)) ||
          (current.content !== null && !intent?.modes.includes(current.mode)));
      return {
        ...file,
        current,
        original,
        changed,
        bindingChanged,
        outsideChanges,
        conflict: bindingChanged || (outsideChanges && !options.archiveChanges),
      };
    }),
  );
  const removed = new Set([
    ...files.filter((file) => file.changed && file.original === null).map((file) => file.realFile),
    ...artifacts
      .filter((entry) => entry.changed && entry.original === null)
      .map((entry) => entry.current.physicalPath),
  ]);
  const directories = [];
  const candidates = [
    ...new Set([
      ...baseline.files.flatMap((file) => file.missingParents ?? []),
      ...artifacts.flatMap((entry) => entry.missingParents),
    ]),
  ].sort((left, right) => right.length - left.length);
  for (const directory of candidates) {
    try {
      const stat = await fs.lstat(directory);
      const remove =
        stat.isDirectory() &&
        !stat.isSymbolicLink() &&
        (await fs.readdir(directory)).every((name) => removed.has(path.join(directory, name)));
      if (remove) removed.add(directory);
      directories.push({ path: directory, remove });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  const lockBlocked = locks.some(
    (lock) =>
      (ownPid === undefined || lock.pid !== ownPid) &&
      (lock.status === 'active' ||
        lock.status === 'unknown' ||
        (lock.status === 'stale' && !options.recoverLock)),
  );
  const hubChanged = hub.fingerprint !== baseline.hub.fingerprint;
  const revision = hash(
    stableStringify({ baseline, expected, hub, files, artifacts, directories, options }),
  );
  return {
    root,
    options,
    baseline,
    hub,
    hubChanged,
    files,
    artifacts,
    directories,
    locks,
    revision,
    blocked:
      lockBlocked ||
      files.some((file) => file.conflict) ||
      artifacts.some((entry) => entry.conflict),
    changed:
      hubChanged ||
      files.some((file) => file.changed) ||
      artifacts.some((entry) => entry.changed) ||
      directories.some((directory) => directory.remove),
  };
}

export function publicResetPlan(plan: Awaited<ReturnType<typeof planReset>>) {
  const flags = [
    ...(plan.options.archiveChanges ? ['--archive-changes'] : []),
    ...(plan.options.recoverLock ? ['--recover-lock'] : []),
  ];
  const context = {
    root: plan.root,
    node: process.execPath,
    cli: fileURLToPath(new URL('../../dist/cli.js', import.meta.url)),
  };
  return {
    revision: plan.revision,
    blocked: plan.blocked,
    changed: plan.changed,
    baseline: {
      capturedAt: plan.baseline.capturedAt,
      scope: plan.baseline.scope,
      location: baselineDirectory(plan.root),
    },
    hub: {
      path: plan.root,
      action: !plan.hubChanged
        ? 'keep'
        : plan.baseline.hub.exists
          ? 'archive-current-and-restore-original'
          : 'archive-created-hub',
      currentFiles: plan.hub.entries.length,
    },
    files: [
      ...plan.files.map((file) => ({
        path: file.file,
        client: file.client,
        action: !file.changed
          ? 'keep'
          : file.original === null
            ? 'archive-created-file'
            : 'restore-original',
        conflict: file.conflict,
        outsideChanges: file.outsideChanges,
        bindingChanged: file.bindingChanged,
      })),
      ...plan.artifacts.map((entry) => ({
        path: entry.before.path,
        client: entry.client,
        action: !entry.changed
          ? 'keep'
          : entry.original === null
            ? 'archive-created-artifact'
            : 'restore-original-artifact',
        conflict: entry.conflict,
        outsideChanges: entry.outsideChanges,
        bindingChanged: entry.bindingChanged,
      })),
    ],
    directories: plan.directories.map((directory) => ({
      path: directory.path,
      action: directory.remove ? 'remove-created-empty-directory' : 'keep-user-data',
    })),
    locks: plan.locks.map(({ file, status, pid }) => ({ path: file, status, pid })),
    commands: {
      dryRun: hubCommand(context, ['reset', ...flags, '--dry-run']),
      apply: hubCommand(context, ['reset', ...flags, '--apply', '--expect', plan.revision]),
    },
    note:
      plan.baseline.scope === 'existing-hub-checkpoint'
        ? 'This restores the first recorded checkpoint of an existing hub, not its unknown historical pre-install state.'
        : 'This restores the recorded state from before hub creation. Current data is archived, not discarded.',
  };
}

export async function applyReset(
  plan: Awaited<ReturnType<typeof planReset>>,
  expectedRevision?: string,
) {
  if (expectedRevision !== plan.revision)
    throw new HubError('Reset requires --expect from the reviewed dry run.');
  if (plan.blocked)
    throw new HubError(
      'Reset is blocked by changed files, symlink bindings or locks. Review the dry run.',
    );
  if (plan.options.recoverLock) await recoverLocks(plan.root);
  if (!plan.changed)
    return {
      restoredFiles: 0,
      archive: null,
      hubRestored: false,
      retainedDirectories: [] as string[],
    };
  return withHubLock(
    plan.root,
    async () => {
      const fresh = await planReset(plan.options, plan.root, process.pid);
      if (fresh.revision !== plan.revision || fresh.blocked)
        throw new HubError('State changed since the reset preview. Review again.');
      const id = `reset-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomBytes(4).toString('hex')}`;
      const archive = path.join(recoveryRoot(plan.root), 'archives', id);
      await fs.mkdir(archive, { recursive: true, mode: 0o700 });
      const staging = path.join(archive, 'original-hub');
      if (fresh.hubChanged && fresh.baseline.hub.exists)
        await copyTree(path.join(baselineDirectory(plan.root), 'hub'), staging);
      const changed = fresh.files.filter((file) => file.changed);
      const artifactChanges = await prepareArtifacts(
        archive,
        await Promise.all(
          fresh.artifacts
            .filter((entry) => entry.changed)
            .map(async (entry) => ({
              before: entry.current,
              client: entry.client,
              value: entry.original
                ? { kind: 'copy' as const, source: await inspectArtifact(entry.original) }
                : { kind: 'missing' as const },
            })),
        ),
      );
      const changes = changed.map((file) => ({
        before: { ...file.current, mode: file.mode },
        after: file.original,
      }));
      const archiveFiles = [];
      for (const [index, file] of changed.entries()) {
        const payload = file.current.content === null ? null : `${index}.txt`;
        if (payload)
          await fs.writeFile(path.join(archive, payload), file.current.content!, {
            flag: 'wx',
            mode: 0o600,
          });
        archiveFiles.push({
          path: file.file,
          realFile: file.current.realFile,
          mode: file.current.mode,
          hash: hash(file.current.content),
          payload,
        });
      }
      await writeAtomic(
        path.join(archive, 'manifest.json'),
        JSON.stringify(
          {
            version: 1,
            state: 'started',
            root: plan.root,
            files: archiveFiles,
            artifacts: artifactChanges,
          },
          null,
          2,
        ),
        0o600,
      );
      await recordExpectedWrites(plan.root, changes);
      await recordArtifactWrites(plan.root, artifactChanges);
      let filesWritten = false;
      let artifactsWritten = false;
      let hubMoved = false;
      let originalInstalled = false;
      try {
        await writeArtifactTransaction(artifactChanges);
        artifactsWritten = true;
        await writeTransaction(changes);
        filesWritten = true;
        await recordArtifactWrites(plan.root, artifactChanges, false);
        if ((await inspectTree(plan.root)).fingerprint !== fresh.hub.fingerprint)
          throw new HubError('Hub changed during reset.');
        if (fresh.hubChanged) {
          if (fresh.hub.exists) {
            await fs.rename(plan.root, path.join(archive, 'hub'));
            hubMoved = true;
          }
          if (fresh.baseline.hub.exists) {
            await fs.rename(staging, plan.root);
            originalInstalled = true;
          }
        }
        await writeAtomic(
          path.join(archive, 'manifest.json'),
          JSON.stringify(
            {
              version: 1,
              state: 'complete',
              root: plan.root,
              files: archiveFiles,
              artifacts: artifactChanges,
            },
            null,
            2,
          ),
          0o600,
        );
        // The held inner lock moved with the archived hub; it is not user data.
        if (hubMoved) {
          const movedLock = path.join(archive, 'hub', 'state', 'sync.lock');
          try {
            if ((await fs.readFile(movedLock, 'utf8')) === String(process.pid))
              await fs.unlink(movedLock);
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
          }
        }
        const retainedDirectories: string[] = [];
        for (const directory of fresh.directories.filter((entry) => entry.remove)) {
          try {
            await fs.rmdir(directory.path);
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
              retainedDirectories.push(directory.path);
          }
        }
        return {
          restoredFiles: changed.length + artifactChanges.length,
          archive,
          hubRestored: fresh.hubChanged,
          retainedDirectories,
        };
      } catch (error) {
        try {
          if (originalInstalled)
            await fs.rename(plan.root, path.join(archive, 'failed-original-hub'));
          if (hubMoved) await fs.rename(path.join(archive, 'hub'), plan.root);
          if (filesWritten)
            await writeTransaction(
              changed.map((file) => ({
                before: { ...file.current, content: file.original },
                after: file.current.content,
              })),
            );
          if (artifactsWritten) {
            const reverse: ArtifactChange[] = [];
            for (const change of [...artifactChanges].reverse()) {
              const before = await inspectArtifact(change.before.path);
              if (
                before.fingerprint !== change.afterFingerprint ||
                before.physicalPath !== change.before.physicalPath
              )
                throw new HubError('An artifact changed during reset rollback.');
              reverse.push({
                before,
                source: change.rollbackSource,
                rollbackSource: change.source,
                afterFingerprint: change.before.fingerprint,
              });
            }
            await writeArtifactTransaction(reverse);
          }
        } catch {
          throw new HubError(
            `Reset stopped; recovery needs manual review. Current data and originals remain in ${archive}.`,
          );
        }
        throw new HubError(`Reset stopped and changes were rolled back. Archive: ${archive}.`, {
          cause: error,
        });
      }
    },
    { createHub: false },
  );
}
