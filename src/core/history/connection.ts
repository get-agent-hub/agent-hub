import path from 'node:path';
import type { ClientId } from '../../contracts/clients.js';
import { HubError } from '../../shared/errors.js';
import { snapshot, writeChecked } from '../../shared/file-store.js';
import { writeTransaction } from '../../shared/file-transaction.js';
import { withHubLock } from '../../shared/hub-lock.js';
import { cliPath } from '../../shared/runtime.js';
import { hash, stableStringify } from '../../shared/values.js';
import { parseRegistry, serializeRegistry } from '../configuration/registry.js';
import { readSettings } from '../configuration/settings.js';
import {
  applySync,
  defaultSyncContext,
  planSync,
  publicSyncPlan,
  type SyncContext,
} from '../mcp/sync.js';
import { ensureBaseline, recordExpectedWrites } from '../recovery/baseline.js';
import { withWorkflowRecovery } from '../recovery/workflow-recovery.js';
import { ownedHistoryPath, readHistory } from './storage.js';

export async function planHistoryConnection(
  root: string,
  project: string,
  clients?: ClientId[],
  supplied?: SyncContext,
) {
  const catalog = await readHistory(root);
  const selected = catalog.projects.find((item) => item.id === project);
  if (!selected || catalog.excluded.includes(project))
    throw new HubError('Choose an included saved project.');
  const context = supplied ?? (await defaultSyncContext());
  if (path.resolve(context.root) !== path.resolve(root))
    throw new HubError('History connection belongs to another Hub.');
  const settings = await readSettings(root);
  const targets = context.targets.filter(
    (target) =>
      target.installed &&
      settings.clients?.[target.id]?.enabled !== false &&
      (!clients || clients.includes(target.id)),
  );
  if (!targets.length || clients?.some((client) => !targets.some((target) => target.id === client)))
    throw new HubError('Choose detected clients for this connection.');
  const sourceIds = [
    ...new Set(
      catalog.chats
        .filter(
          (chat) => chat.projects.includes(project) && !catalog.excluded.includes(chat.sourceId),
        )
        .map((chat) => chat.sourceId),
    ),
  ];
  if (!sourceIds.length) throw new HubError('Capture this project history before connecting it.');
  const grant = `history-${project.slice(0, 20)}`;
  const registry = await snapshot(path.join(root, 'mcp', 'servers.yaml'));
  if (registry.content === null)
    throw new HubError('Set up the shared Hub before connecting history.');
  const parsed = parseRegistry(registry.content);
  const server = {
    transport: 'stdio' as const,
    command: context.node,
    args: [context.cli || cliPath, 'history', 'serve', '--grant', grant],
    env: { AGENT_HUB_HOME: root },
    only: targets.map((target) => target.id),
    tags: ['agent-hub-history'],
  };
  const existing = parsed.servers[grant];
  if (existing && !existing.tags?.includes('agent-hub-history'))
    throw new HubError(
      'This history server name belongs to another definition. Preserve it and choose another Hub.',
    );
  parsed.servers[grant] = server;
  const nextRegistry = serializeRegistry(parsed);
  const next = structuredClone(catalog);
  next.grants = [
    ...next.grants.filter((item) => item.id !== grant),
    { id: grant, projects: [project], sources: sourceIds },
  ];
  const catalogFile = await snapshot(await ownedHistoryPath(root, 'catalog.json'));
  const sync = await Promise.all(
    targets.map((target) => planSync({ client: target.id, only: [grant] }, context, nextRegistry)),
  );
  const revision = hash(
    stableStringify({
      catalog: catalogFile,
      registry,
      nextRegistry,
      next,
      revisions: sync.map((plan) => plan.revision),
    }),
  );
  return {
    project,
    clients: targets.map((target) => target.id),
    context,
    registry,
    catalogFile,
    nextRegistry,
    nextCatalog: JSON.stringify(next) + '\n',
    sync,
    publicPlan: {
      revision,
      project: { id: project, label: selected.label },
      grant,
      blocked: sync.some((plan) => plan.blocked),
      sources: sourceIds.length,
      clients: targets.map((target) => target.id),
      deliveries: sync.map(publicSyncPlan),
      note: 'Allow these clients to search and read this project’s archived history through a read-only MCP connection. Other projects remain outside the grant. Native sessions stay unchanged. Client restart/trust approval may be required.',
    },
  };
}
export async function applyHistoryConnection(
  plan: Awaited<ReturnType<typeof planHistoryConnection>>,
  expect: string,
) {
  const root = plan.context.root;
  return withHubLock(root, async (origin) => {
    const fresh = await planHistoryConnection(root, plan.project, plan.clients, plan.context);
    if (
      expect !== plan.publicPlan.revision ||
      fresh.publicPlan.revision !== expect ||
      fresh.publicPlan.blocked
    )
      throw new HubError(
        'History connection changed or is blocked. Review a fresh connection plan.',
      );
    await ensureBaseline(
      root,
      plan.context.targets.map((target) => ({
        file: target.file,
        client: target.id,
        installed: target.installed,
      })),
      origin,
    );
    return withWorkflowRecovery(
      root,
      'hub',
      async () => {
        if (
          (await planHistoryConnection(root, plan.project, plan.clients, plan.context)).publicPlan
            .revision !== expect
        )
          throw new HubError('History connection changed since review.');
      },
      async () => {
        const changes = [
          { before: fresh.registry, after: fresh.nextRegistry },
          { before: fresh.catalogFile, after: fresh.nextCatalog },
        ];
        await recordExpectedWrites(root, changes);
        await writeTransaction(changes, writeChecked);
        const steps = [];
        for (const sync of fresh.sync) {
          try {
            const current = await planSync(sync.options, fresh.context);
            const targetView = (value: typeof sync) =>
              value.targets.map((target) => ({
                snapshot: target.snapshot,
                next: target.next,
                rows: target.rows,
              }));
            if (stableStringify(targetView(current)) !== stableStringify(targetView(sync)))
              throw new HubError('Client delivery changed after review.');
            steps.push({
              client: sync.options.client,
              status: 'complete',
              ...(await applySync(current, current.revision)),
            });
          } catch {
            steps.push({
              client: sync.options.client,
              status: 'failed',
              note: 'Client settings changed or could not be written. The grant and Hub definition are retained; review this connection again.',
            });
          }
        }
        return {
          grant: fresh.publicPlan.grant,
          status: steps.every((step) => step.status === 'complete') ? 'complete' : 'needs-review',
          steps,
        };
      },
    );
  });
}
