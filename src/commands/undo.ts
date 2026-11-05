import { applyUndo, planUndo, publicUndoPlan } from '../core/recovery/workflow-recovery.js';
import { HubError } from '../shared/errors.js';
import { printJson, table } from '../shared/output.js';
import { confirmReviewed, reviewMode } from './review.js';

export async function undoCommand(
  id: string,
  options: { apply?: boolean; dryRun?: boolean; expect?: string; json?: boolean },
) {
  const review = { ...options, terminalDefault: true };
  const mode = reviewMode(review);
  if (options.apply && !options.expect)
    throw new HubError('Preview undo and use its exact --expect revision.');
  const plan = await planUndo(id);
  if (options.expect && options.expect !== plan.revision)
    throw new HubError('State changed since the undo preview. Review a new plan.');
  const preview = publicUndoPlan(plan);
  const execute = async (expect: string) => {
    const result = await applyUndo(plan, expect);
    if (options.json) printJson(result);
    else
      console.log(`Undone ${result.run}. Current data archive: ${result.archive ?? 'no changes'}`);
  };
  if (options.apply) return execute(options.expect!);
  {
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
          : mode === 'prompt'
            ? 'Review the paths above before confirming.'
            : `Apply this exact undo:\n${preview.commands.apply}`,
      );
    }
    if (plan.blocked) process.exitCode = 1;
    if (await confirmReviewed(review, plan.blocked)) await execute(plan.revision);
  }
}
