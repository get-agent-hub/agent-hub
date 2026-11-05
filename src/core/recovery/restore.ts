import fs from 'node:fs/promises';
import path from 'node:path';
import { HubError } from '../../shared/errors.js';
import { snapshot } from '../../shared/file-store.js';
import { writeTransaction } from '../../shared/file-transaction.js';
import { withHubLock as withSyncLock } from '../../shared/hub-lock.js';
import { hubCommand } from '../../shared/shell.js';
import { hash, stableStringify as stable } from '../../shared/values.js';
import { defaultSyncContext, type BackupManifest, type SyncContext } from '../mcp/sync.js';
import { ensureBaseline, recordExpectedWrites } from './baseline.js';

export async function planRestore(id: string, supplied?: SyncContext) {
  if (!/^sync-[\w-]+$/.test(id))
    throw new HubError('Use the sync backup ID shown after applying a plan.');
  const context = supplied ?? (await defaultSyncContext());
  const dir = path.join(context.root, 'backups', id);
  let manifest: BackupManifest;
  let stateBefore: string | null;
  try {
    manifest = JSON.parse(await fs.readFile(path.join(dir, 'manifest.json'), 'utf8'));
    stateBefore = JSON.parse(
      await fs.readFile(path.join(dir, 'state-before.json'), 'utf8'),
    ).content;
    if (
      manifest.version !== 1 ||
      !Array.isArray(manifest.files) ||
      (stateBefore !== null && typeof stateBefore !== 'string')
    )
      throw new Error();
  } catch {
    throw new HubError(`Cannot read backup ${id}.`);
  }
  const files = [];
  for (const f of manifest.files) {
    const target = context.targets.find((t) => t.id === f.client && t.file === f.file);
    if (!target || (f.backup !== null && !/^\d+\.conf$/.test(f.backup)))
      throw new HubError('Backup targets do not match the configured client paths.');
    const current = await snapshot(f.file);
    const original = f.backup === null ? null : await fs.readFile(path.join(dir, f.backup), 'utf8');
    if (hash(original) !== f.beforeHash)
      throw new HubError('Backup content failed its integrity check.');
    files.push({
      ...f,
      current,
      original,
      conflict: current.realFile !== f.realFile || hash(current.content) !== f.afterHash,
    });
  }
  const state = await snapshot(path.join(context.root, 'state', 'sync.json'));
  const stateConflict = hash(state.content) !== manifest.stateAfterHash;
  const revision = hash(stable({ manifest, stateBefore, files, state }));
  return {
    id,
    context,
    files,
    state,
    stateBefore,
    stateConflict,
    blocked: stateConflict || files.some((f) => f.conflict),
    revision,
  };
}

export function publicRestorePlan(plan: Awaited<ReturnType<typeof planRestore>>) {
  return {
    id: plan.id,
    revision: plan.revision,
    blocked: plan.blocked,
    stateConflict: plan.stateConflict,
    files: plan.files.map((f) => ({
      client: f.client,
      path: f.file,
      action: f.original === null ? 'remove-created-file' : 'restore',
      conflict: f.conflict,
    })),
    applyCommand: hubCommand(plan.context, [
      'restore',
      plan.id,
      '--apply',
      '--expect',
      plan.revision,
    ]),
  };
}

export async function applyRestore(plan: Awaited<ReturnType<typeof planRestore>>) {
  if (plan.blocked)
    throw new HubError(
      'Restore is blocked: a client file or sync state changed after this backup.',
    );
  return withSyncLock(plan.context.root, async (origin) => {
    const fresh = await planRestore(plan.id, plan.context);
    if (fresh.revision !== plan.revision)
      throw new HubError('Configuration changed since the restore preview.');
    await ensureBaseline(
      plan.context.root,
      plan.context.targets.map((target) => ({
        file: target.file,
        client: target.id,
        installed: target.installed,
      })),
      origin,
    );
    const changes = [
      ...fresh.files.map((file) => ({
        before: { ...file.current, mode: file.mode },
        after: file.original,
      })),
      { before: fresh.state, after: fresh.stateBefore },
    ];
    await recordExpectedWrites(plan.context.root, changes);
    await writeTransaction(changes);
    return { restoredFiles: fresh.files.length };
  });
}
