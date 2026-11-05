import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { HubError } from '../../../shared/errors.js';
import { snapshot, writeChecked } from '../../../shared/file-store.js';
import { writeTransaction } from '../../../shared/file-transaction.js';
import { withHubLock as withSyncLock } from '../../../shared/hub-lock.js';
import { hubCommand } from '../../../shared/shell.js';
import { hash } from '../../../shared/values.js';
import { ensureBaseline, recordExpectedWrites } from '../../recovery/baseline.js';
import { stateFile } from './definitions.js';
import type { BackupManifest, SyncPlan } from './types.js';

import { planSync } from './plan.js';
export async function applySync(plan: SyncPlan, expectedRevision?: string) {
  if (plan.options.replace?.length && expectedRevision !== plan.revision)
    throw new HubError('Explicit replacement requires --expect from the reviewed dry run.');
  if (plan.blocked) throw new HubError('Sync is blocked by conflicts. Review the dry run first.');
  return withSyncLock(plan.context.root, async (origin) => {
    const fresh = await planSync(plan.options, plan.context);
    if (fresh.revision !== plan.revision)
      throw new HubError('Configuration changed since the preview. Run a new dry run.');
    if (fresh.blocked) throw new HubError('Sync inputs need review. Run a new dry run.');
    const changes = fresh.targets.filter((t) => t.next !== (t.snapshot.content ?? ''));
    if (!changes.length) return { changedFiles: 0, backup: null, restoreCommand: null };
    await ensureBaseline(
      plan.context.root,
      changes.map(({ target }) => ({
        file: target.file,
        client: target.id,
        installed: target.installed,
      })),
      origin,
    );
    const stateSnapshot = await snapshot(stateFile(plan.context.root));
    if (stateSnapshot.content !== fresh.stateBefore)
      throw new HubError('Sync state changed since planning. Run a new dry run.');
    const id = `sync-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomBytes(4).toString('hex')}`;
    const dir = path.join(plan.context.root, 'backups', id);
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    const nextState = structuredClone(fresh.state);
    for (const t of fresh.targets) {
      if (t.rows.some((r) => r.name === '*' && r.action === 'skip')) continue;
      nextState.clients[t.target.id] = { file: t.target.file, entries: t.owned };
    }
    const nextStateText = JSON.stringify(nextState, null, 2) + '\n';
    const manifest: BackupManifest = { version: 1, files: [], stateAfterHash: hash(nextStateText) };
    for (const [i, t] of changes.entries()) {
      const backup = t.snapshot.content === null ? null : `${i}.conf`;
      if (backup)
        await fs.writeFile(path.join(dir, backup), t.snapshot.content!, {
          mode: 0o600,
          flag: 'wx',
        });
      manifest.files.push({
        client: t.target.id,
        file: t.target.file,
        realFile: t.snapshot.realFile,
        mode: t.snapshot.mode,
        backup,
        beforeHash: hash(t.snapshot.content),
        afterHash: hash(t.next),
      });
    }
    await fs.writeFile(
      path.join(dir, 'state-before.json'),
      JSON.stringify({ content: fresh.stateBefore }),
      { mode: 0o600, flag: 'wx' },
    );
    await fs.writeFile(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2), {
      mode: 0o600,
      flag: 'wx',
    });
    await recordExpectedWrites(plan.context.root, [
      ...changes.map((target) => ({ before: target.snapshot, after: target.next })),
      { before: stateSnapshot, after: nextStateText },
    ]);
    try {
      await writeTransaction(
        [
          ...changes.map((target) => ({ before: target.snapshot, after: target.next })),
          { before: stateSnapshot, after: nextStateText },
        ],
        async (before, after) => {
          if (
            before.file === stateSnapshot.file &&
            (await planSync(plan.options, plan.context)).sourceRevision !== fresh.sourceRevision
          ) {
            throw new HubError('Hub inputs changed during sync. Review a new dry run.');
          }
          await writeChecked(before, after);
        },
      );
    } catch (error) {
      throw new HubError(
        `${error instanceof HubError ? error.message : 'Sync failed.'} Backup: ${dir}.`,
        { cause: error },
      );
    }
    const restoreCommand = hubCommand(plan.context, ['restore', id, '--dry-run']);
    return { changedFiles: changes.length, backup: id, restoreCommand };
  });
}
