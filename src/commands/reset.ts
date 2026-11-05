import { applyReset, planReset, publicResetPlan } from '../core/recovery/reset.js';
import { HubError } from '../shared/errors.js';
import { printJson, table } from '../shared/output.js';

interface Options {
  apply?: boolean;
  dryRun?: boolean;
  expect?: string;
  archiveChanges?: boolean;
  recoverLock?: boolean;
  json?: boolean;
}
export async function resetCommand(options: Options) {
  if (options.apply && options.dryRun) throw new HubError('Choose --dry-run or --apply, not both.');
  const plan = await planReset({
    archiveChanges: options.archiveChanges,
    recoverLock: options.recoverLock,
  });
  if (options.expect && options.expect !== plan.revision)
    throw new HubError('State changed since that reset preview. Review again.');
  const preview = publicResetPlan(plan);
  if (options.apply) {
    const result = await applyReset(plan, options.expect);
    if (options.json) printJson({ ...preview, result });
    else
      console.log(
        `Restored ${result.restoredFiles} original file(s). Current data archived at ${result.archive ?? 'no changes required'}. Restart affected clients.`,
      );
    if (!options.json && result.retainedDirectories.length)
      console.log(
        `Some created directories were retained: ${result.retainedDirectories.join(', ')}.`,
      );
    return;
  }
  if (options.json) printJson({ ...preview, dryRun: true });
  else {
    console.log(
      `Reset — dry run. No files written.\nBaseline: ${preview.baseline.capturedAt} (${preview.baseline.scope})\n${preview.note}`,
    );
    console.log(`\nHub: ${preview.hub.path} → ${preview.hub.action}`);
    console.log(
      table(
        ['client', 'file', 'action', 'review'],
        preview.files.map((file) => [
          file.client,
          file.path,
          file.action,
          file.bindingChanged
            ? 'SYMLINK TARGET CHANGED'
            : file.conflict
              ? 'EXTERNAL EDIT'
              : 'ready',
        ]),
      ),
    );
    for (const lock of preview.locks)
      if (lock.status !== 'absent') console.log(`Lock: ${lock.path} — ${lock.status}`);
    console.log(
      preview.blocked
        ? '\nBlocked. Review external edits or locks. --archive-changes preserves current client files in a private archive before restoring originals. --recover-lock is allowed only for a dead owner.'
        : `\nApply this exact reset:\n${preview.commands.apply}`,
    );
  }
  if (plan.blocked) process.exitCode = 1;
}
