import fs from 'node:fs/promises';
import path from 'node:path';
import { defaultSyncContext, hash, quoteShell, snapshot, stable, SyncError, withSyncLock, writeChecked, type BackupManifest, type SyncContext } from './sync.js';

export async function planRestore(id: string, supplied?: SyncContext) {
  if (!/^sync-[\w-]+$/.test(id)) throw new SyncError('Use the sync backup ID shown after applying a plan.');
  const context = supplied ?? await defaultSyncContext();
  const dir = path.join(context.root, 'backups', id);
  let manifest: BackupManifest;
  let stateBefore: string | null;
  try {
    manifest = JSON.parse(await fs.readFile(path.join(dir, 'manifest.json'), 'utf8'));
    stateBefore = JSON.parse(await fs.readFile(path.join(dir, 'state-before.json'), 'utf8')).content;
    if (manifest.version !== 1 || !Array.isArray(manifest.files) || (stateBefore !== null && typeof stateBefore !== 'string')) throw new Error();
  } catch { throw new SyncError(`Cannot read backup ${id}.`); }
  const files = [];
  for (const f of manifest.files) {
    const target = context.targets.find((t) => t.id === f.client && t.file === f.file);
    if (!target || (f.backup !== null && !/^\d+\.conf$/.test(f.backup))) throw new SyncError('Backup targets do not match the configured client paths.');
    const current = await snapshot(f.file);
    const original = f.backup === null ? null : await fs.readFile(path.join(dir, f.backup), 'utf8');
    if (hash(original) !== f.beforeHash) throw new SyncError('Backup content failed its integrity check.');
    files.push({ ...f, current, original, conflict: current.realFile !== f.realFile || hash(current.content) !== f.afterHash });
  }
  const state = await snapshot(path.join(context.root, 'state', 'sync.json'));
  const stateConflict = hash(state.content) !== manifest.stateAfterHash;
  const revision = hash(stable({ manifest, stateBefore, files, state }));
  return { id, context, files, state, stateBefore, stateConflict, blocked: stateConflict || files.some((f) => f.conflict), revision };
}

export function publicRestorePlan(plan: Awaited<ReturnType<typeof planRestore>>) {
  return {
    id: plan.id, revision: plan.revision, blocked: plan.blocked, stateConflict: plan.stateConflict,
    files: plan.files.map((f) => ({ client: f.client, path: f.file, action: f.original === null ? 'remove-created-file' : 'restore', conflict: f.conflict })),
    applyCommand: `AGENT_HUB_HOME=${quoteShell(plan.context.root)} ${[plan.context.node, plan.context.cli, 'restore', plan.id, '--apply', '--expect', plan.revision].map(quoteShell).join(' ')}`,
  };
}

export async function applyRestore(plan: Awaited<ReturnType<typeof planRestore>>) {
  if (plan.blocked) throw new SyncError('Restore is blocked: a client file or sync state changed after this backup.');
  return withSyncLock(plan.context.root, async () => {
    const fresh = await planRestore(plan.id, plan.context);
    if (fresh.revision !== plan.revision) throw new SyncError('Configuration changed since the restore preview.');
    const written: typeof fresh.files = [];
    try {
      for (const f of fresh.files) { await writeChecked({ ...f.current, mode: f.mode }, f.original); written.push(f); }
      await writeChecked(fresh.state, fresh.stateBefore);
    } catch {
      const failed: string[] = [];
      for (const f of written.reverse()) {
        try { await writeChecked({ ...f.current, content: f.original }, f.current.content); }
        catch { failed.push(f.client); }
      }
      throw new SyncError(failed.length ? `Restore stopped; review ${failed.join(', ')} using backup ${plan.id}.` : 'Restore stopped and changes were rolled back.');
    }
    return { restoredFiles: fresh.files.length };
  });
}
