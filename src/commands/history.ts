import { Command } from 'commander';
import { historySource } from '../adapters/history/sources.js';
import { ingestHistory } from '../core/history/ingest.js';
import { planHistoryConnection, applyHistoryConnection } from '../core/history/connection.js';
import { historyOverview } from '../core/history/overview.js';
import { applyHistoryPolicy, planHistoryPolicy } from '../core/history/policy.js';
import {
  listHistory,
  readConversation,
  readHistoryEvent,
  searchHistory,
} from '../core/history/query.js';
import { rebuildHistory } from '../core/history/rebuild.js';
import { watchHistory } from '../core/history/watch.js';
import { CLIENT_IDS, type ClientId } from '../contracts/clients.js';
import { HubError } from '../shared/errors.js';
import { printJson } from '../shared/output.js';
import { hubRoot } from '../shared/paths.js';

const operator = { operator: true } as const;
export function registerHistoryCommands(
  program: Command,
  serveHistory: (root: string, grant: string) => Promise<unknown>,
) {
  const history = program.command('history');
  history
    .command('connect <project>')
    .option('--client <ids>', 'comma-separated native client IDs')
    .option('--apply', 'apply the exact reviewed history connection')
    .option('--expect <revision>', 'required reviewed connection revision')
    .action(async (project, options) => {
      const plan = await planHistoryConnection(hubRoot(), project, options.client?.split(','));
      printJson(
        options.apply ? await applyHistoryConnection(plan, options.expect ?? '') : plan.publicPlan,
      );
    });
  const queryOptions = (command: Command) =>
    command
      .option('--project <id>', 'filter one discovered project')
      .option('--client <id>', 'filter one native client')
      .option('--offset <count>', 'result offset', '0')
      .option('--limit <count>', 'maximum results, 1–100', '50');
  const query = (options: Record<string, string>) => ({
    ...options,
    offset: Number(options.offset),
    limit: Number(options.limit),
  });
  history
    .command('status')
    .action(async () => printJson(await historyOverview(hubRoot(), operator)));
  history
    .command('scan')
    .option('--client <id>', 'read only this native client')
    .option('--root <directory>', 'explicit native store root; requires --client')
    .action(async (options) => {
      const control = cancellation();
      try {
        let sources;
        if (options.client) {
          if (!CLIENT_IDS.includes(options.client))
            throw new HubError('Choose claude-code, codex or dsh.');
          const { historySources } = await import('../adapters/history/sources.js');
          sources = options.root
            ? [historySource(options.client as ClientId, options.root)]
            : (await historySources()).filter((source) => source.client === options.client);
        } else if (options.root) throw new HubError('An explicit store root requires --client.');
        const catalog = await ingestHistory(hubRoot(), sources, { signal: control.signal });
        printJson({
          receipts: catalog.receipts,
          chats: catalog.chats.length,
          events: catalog.chats.reduce((total, chat) => total + chat.events, 0),
        });
      } finally {
        control.close();
      }
    });
  queryOptions(history.command('ls')).action(async (options) =>
    printJson(await listHistory(hubRoot(), operator, query(options))),
  );
  queryOptions(history.command('search <query>')).action(async (phrase, options) => {
    const control = cancellation();
    try {
      printJson(
        await searchHistory(
          hubRoot(),
          operator,
          { ...query(options), query: phrase },
          control.signal,
        ),
      );
    } finally {
      control.close();
    }
  });
  queryOptions(history.command('show <id>'))
    .option('--revision <hash>', 'read a preserved older revision')
    .action(async (id, options) =>
      printJson(await readConversation(hubRoot(), operator, id, query(options))),
    );
  history
    .command('event <id> <ordinal>')
    .option('--offset <count>', 'character offset in the complete native event', '0')
    .option('--revision <hash>', 'preserved revision')
    .action(async (id, ordinal, options) =>
      printJson(
        await readHistoryEvent(
          hubRoot(),
          operator,
          id,
          Number(ordinal),
          Number(options.offset),
          options.revision,
        ),
      ),
    );
  history
    .command('watch')
    .option('--interval <seconds>', 'foreground periodic refresh, 5–300 seconds', '30')
    .action(async (options) => {
      const control = cancellation();
      try {
        await watchHistory(hubRoot(), {
          signal: control.signal,
          interval: Number(options.interval),
        });
      } catch (error) {
        if (!control.signal.aborted) throw error;
      } finally {
        control.close();
      }
    });
  history.command('rebuild').action(async () => printJson(await rebuildHistory(hubRoot())));
  history
    .command('policy <file>')
    .option('--apply', 'apply a reviewed policy change')
    .option('--expect <revision>', 'exact reviewed policy revision')
    .action(async (file, options) => {
      const fs = await import('node:fs/promises');
      if ((await fs.stat(file)).size > 16384)
        throw new HubError('History policy file is too large.');
      const input: unknown = JSON.parse(await fs.readFile(file, 'utf8'));
      const plan = await planHistoryPolicy(hubRoot(), input);
      printJson(
        options.apply
          ? await applyHistoryPolicy(hubRoot(), input, options.expect ?? '')
          : { change: plan.change, revision: plan.revision, note: plan.note },
      );
    });
  history
    .command('serve')
    .requiredOption('--grant <id>', 'persisted archive read grant for this connection')
    .action(async (options) => {
      await serveHistory(hubRoot(), options.grant);
    });
}
function cancellation() {
  const control = new AbortController();
  const cancel = () =>
    control.abort(new HubError('History operation stopped. Completed archive units are retained.'));
  process.once('SIGINT', cancel);
  process.once('SIGTERM', cancel);
  return {
    signal: control.signal,
    close: () => {
      process.off('SIGINT', cancel);
      process.off('SIGTERM', cancel);
    },
  };
}
