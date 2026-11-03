import { planQuick, applyQuick } from '../core/quick.js';
import { printJson, table } from '../core/output.js';
import { HubError } from '../core/errors.js';
import type { ClientId } from '../core/types.js';

export async function quickCommand(options: {
  workspace?: string;
  client?: string;
  prefer?: ClientId;
  project?: boolean;
  automation?: boolean;
  at?: string;
  apply?: boolean;
  dryRun?: boolean;
  expect?: string;
  json?: boolean;
}) {
  if (options.apply && options.dryRun) throw new HubError('Choose either --apply or --dry-run.');
  if (options.apply && (!options.expect || !options.at))
    throw new HubError(
      'Run ahub quick first, then use its reviewed apply command with --expect and --at.',
    );
  const plan = await planQuick({
    ...options,
    clients: options.client?.split(',') as ClientId[] | undefined,
  });
  const result = options.apply ? await applyQuick(plan, options.expect!) : plan.publicPlan;
  if (options.json) printJson(result);
  else {
    console.log(
      options.apply
        ? `Quick setup: ${'status' in result ? result.status : ''}`
        : 'Quick setup preview — no files changed',
    );
    console.log(
      `Hub: ${result.root}\nWorkspace: ${result.workspace ?? 'global setup only'}\nClients: ${result.clients.join(', ') || 'none detected'}`,
    );
    console.log(
      table(
        ['stage', 'status', 'detail'],
        result.steps.map((step) => [
          step.title,
          step.status,
          step.note ??
            (step.changed !== undefined
              ? `${step.changed} change(s)`
              : `${step.rows?.length ?? 0} item(s)`),
        ]),
      ),
    );
    for (const step of result.steps) {
      for (const row of step.rows ?? [])
        if (['conflict', 'error', 'preserve'].includes(row.action))
          console.log(`  Review ${row.name}: ${row.note ?? row.action}`);
      if (step.restoreCommand) console.log(`  Restore ${step.title}: ${step.restoreCommand}`);
    }
    console.log(`\n${result.recovery}`);
    if ('commands' in result) {
      for (const warning of result.warnings) console.log(`Notice: ${warning}`);
      if (result.blocked)
        console.log('No enabled clients detected. Install a supported client or review hub.yaml.');
      else console.log(`\nApply this workflow:\n${result.commands.apply}`);
      console.log(`\nPreview original-state recovery:\n${result.commands.reset}`);
    } else {
      for (const next of result.next) console.log(`\n${next}`);
      console.log(`\nPreview original-state recovery:\n${result.resetCommand}`);
    }
  }
  if (options.apply && 'status' in result && result.status !== 'complete') process.exitCode = 1;
}
