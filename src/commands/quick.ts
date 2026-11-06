import { recordUsage } from '../core/telemetry/usage.js';
import type { ClientId } from '../contracts/clients.js';
import {
  applyProjectConnect,
  applyQuick,
  planProjectConnect,
  planQuick,
} from '../core/setup/quick.js';
import { HubError } from '../shared/errors.js';
import { printJson, table } from '../shared/output.js';
import { confirmReviewed, reviewMode } from './review.js';

interface Options {
  advanced?: boolean;
  workspace?: string;
  client?: string;
  prefer?: ClientId;
  project?: boolean;
  automation?: boolean;
  at?: string;
  interactive?: boolean;
  apply?: boolean;
  dryRun?: boolean;
  expect?: string;
  json?: boolean;
}

export function quickCommand(options: Options) {
  if (options.workspace !== undefined || options.automation === false)
    throw new HubError(
      'ahub quick sets up the shared Hub without a project. Use ahub project connect <directory> for project memory, handoff files and hooks.',
    );
  return runSetup(options, 'hub');
}

export function projectConnectCommand(directory: string | undefined, options: Options) {
  return runSetup({ ...options, workspace: directory ?? process.cwd() }, 'project');
}

async function runSetup(options: Options, scope: 'hub' | 'project') {
  const review = { ...options, terminalDefault: true };
  const mode = reviewMode(review);
  if (options.apply && (!options.expect || !options.at))
    throw new HubError(
      'Run a preview first, then use its complete apply command with --expect and --at.',
    );
  const clients = options.client?.split(',') as ClientId[] | undefined;
  const plan =
    scope === 'hub'
      ? await planQuick({ clients, prefer: options.prefer, at: options.at })
      : await planProjectConnect({
          clients,
          workspace: options.workspace,
          automation: options.automation,
          at: options.at,
        });
  const apply = (expect: string) =>
    (scope === 'hub' ? applyQuick : applyProjectConnect)(plan, expect);
  if (options.apply) return report(await apply(options.expect!), true);
  report(plan.publicPlan, false);
  if (await confirmReviewed(review, plan.publicPlan.blocked))
    report(await apply(plan.publicPlan.revision), true);

  function report(
    result: typeof plan.publicPlan | Awaited<ReturnType<typeof apply>>,
    applied: boolean,
  ) {
    if (applied && scope === 'hub' && 'status' in result && result.status === 'complete')
      recordUsage('setup_completed');
    if (options.json) printJson(result);
    else {
      console.log(
        applied
          ? `${scope === 'hub' ? 'Shared Hub setup' : 'Project connection'}: ${'status' in result ? result.status : ''}`
          : `${scope === 'hub' ? 'Shared Hub setup' : 'Project connection'} preview — no files changed`,
      );
      console.log(
        `Scope: ${scope === 'hub' ? 'Shared Hub · global client settings' : 'One Git project · memory and handoff'}\nHub storage: ${result.root}${result.workspace ? `\nProject directory: ${result.workspace}` : ''}\nClients: ${result.clients.join(', ') || 'none detected'}`,
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
        if (options.advanced && step.restoreCommand)
          console.log(`  Restore ${step.title}: ${step.restoreCommand}`);
      }
      console.log(`\n${result.recovery}`);
      if ('commands' in result) {
        for (const warning of result.warnings) console.log(`Notice: ${warning}`);
        if (result.blocked)
          console.log(
            'No enabled clients detected. Install a supported client or review hub.yaml.',
          );
        else if (mode !== 'prompt') console.log(`\nApply this workflow:\n${result.commands.apply}`);
        if (options.advanced)
          console.log(`\nPreview original-state recovery:\n${result.commands.reset}`);
      } else {
        for (const next of result.next) console.log(`\n${next}`);
        if ('undoCommand' in result) console.log(`\nUndo this workflow:\n${result.undoCommand}`);
        if (options.advanced)
          console.log(`\nPreview original-state recovery:\n${result.resetCommand}`);
      }
    }
    if (
      (applied && 'status' in result && result.status !== 'complete') ||
      ('blocked' in result && result.blocked)
    )
      process.exitCode = 1;
  }
}
