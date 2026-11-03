import { planUndo, publicUndoPlan, applyUndo } from '../core/workflow-recovery.js';
import { printJson, table } from '../core/output.js';
import { HubError } from '../core/errors.js';

export async function undoCommand(
  id: string,
  options: { apply?: boolean; dryRun?: boolean; expect?: string; json?: boolean },
) {
  if (options.apply && options.dryRun) throw new HubError('Choose --apply or --dry-run.');
  if (options.apply && !options.expect)
    throw new HubError('Preview undo and use its exact --expect revision.');
  const plan = await planUndo(id);
  if (options.expect && options.expect !== plan.revision)
    throw new HubError('State changed since the undo preview. Review a new plan.');
  const preview = publicUndoPlan(plan);
  if (options.apply) {
    const result = await applyUndo(plan, options.expect!);
    if (options.json) printJson(result);
    else
      console.log(`Undone ${result.run}. Current data archive: ${result.archive ?? 'no changes'}`);
  } else {
    if (options.json) printJson(preview);
    else {
      console.log(`${preview.run} (${preview.scope}) — preview only.\n${preview.note}`);
      console.log(
        table(
          ['path', 'action', 'review'],
          [
            [preview.hub.path, preview.hub.action, preview.changedAfterRun ? 'later changes' : ''],
            ...preview.paths.map((item) => [
              item.path,
              item.action,
              item.conflict ? 'conflict' : '',
            ]),
            ...preview.directories.map((item) => [item.path, item.action, '']),
          ],
        ),
      );
      console.log(
        preview.blocked
          ? 'Blocked; no files changed.'
          : `Apply this exact undo:\n${preview.commands.apply}`,
      );
    }
    if (plan.blocked) process.exitCode = 1;
  }
}
