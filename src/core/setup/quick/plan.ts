import path from 'node:path';
import { adapters } from '../../../adapters/index.js';
import { CLIENT_IDS } from '../../../contracts/clients.js';
import { HubError } from '../../../shared/errors.js';
import { readOptionalText } from '../../../shared/file-store.js';
import { hubRoot } from '../../../shared/paths.js';
import { cliPath } from '../../../shared/runtime.js';
import { hubCommand } from '../../../shared/shell.js';
import { hash, stableStringify } from '../../../shared/values.js';
import { defaultContentContext } from '../../configuration/content-context.js';
import { readSettings } from '../../configuration/settings.js';
import { planImport } from '../../mcp/import-plan.js';
import { planSync, publicSyncPlan } from '../../mcp/sync.js';
import { discoverMemory } from '../../memory/discovery.js';
import {
  memoryCheckout,
  memoryCheckoutBinding,
  memoryRegistry,
} from '../../projects/memory-bindings.js';
import { planSkillImport } from '../../skills/skill-import.js';
import { planQuickInit } from '../quick-init.js';
import { reviewRows } from './review.js';
import type { ProjectConnectOptions, QuickOptions, SetupOptions } from './types.js';

import { setupGuards } from './guards.js';
import { setupSteps } from './preview.js';
export function planQuick(input: QuickOptions = {}) {
  if ('workspace' in input || 'project' in input || 'automation' in input)
    throw new HubError(
      'Quick configures the shared Hub. Use ahub project connect <directory> for project memory and handoff.',
    );
  return planSetup({ ...input, scope: 'hub' });
}
export function planProjectConnect(input: ProjectConnectOptions = {}) {
  return planSetup({ ...input, scope: 'project' });
}
/** Scope approval for a staged workflow. Dependent plans are rebuilt after collection. */
export async function planSetup(input: SetupOptions) {
  if (
    input.clients &&
    (!Array.isArray(input.clients) ||
      !input.clients.length ||
      input.clients.some((id) => !CLIENT_IDS.includes(id)))
  )
    throw new HubError('Select at least one known client.');
  if (input.prefer && !CLIENT_IDS.includes(input.prefer))
    throw new HubError('Unknown source preference.');
  const root = hubRoot();
  const at = input.at ?? new Date().toISOString();
  if (!Number.isFinite(Date.parse(at)) || new Date(at).toISOString() !== at)
    throw new HubError('Use an ISO timestamp from the quick preview.');
  const initialized = (await readOptionalText(path.join(root, 'hub.yaml'))) !== null;
  if (input.scope === 'project' && !initialized)
    throw new HubError('Create your shared Hub with ahub quick before connecting a project.');
  const settings = await readSettings(root, true);
  const context = await defaultContentContext();
  const clients = context.clients.filter(
    (client) =>
      client.installed &&
      settings.clients?.[client.id]?.enabled !== false &&
      (!input.clients || input.clients.includes(client.id)),
  );
  if (input.clients?.some((id) => !clients.some((client) => client.id === id)))
    throw new HubError('A selected client is unavailable or disabled in hub.yaml.');
  const ids = clients.map((client) => client.id);
  const selectedContext = {
    root,
    clients: context.clients.filter((client) => ids.includes(client.id)),
  };
  const workspace =
    input.scope === 'project' ? await memoryCheckout(input.workspace ?? process.cwd()) : null;
  const options: SetupOptions = {
    scope: input.scope,
    prefer: input.scope === 'hub' ? input.prefer : undefined,
    workspace: workspace ?? undefined,
    clients: ids,
    automation: input.scope === 'project' && input.automation !== false,
    at,
  };
  const sources = adapters.filter((adapter) => ids.includes(adapter.id));
  const init = input.scope === 'hub' ? await planQuickInit(root, ids) : null;
  const mcp =
    input.scope === 'hub'
      ? await planImport('mcp', { prefer: input.prefer ?? '', allowUninitialized: true }, sources)
      : null;
  const skills =
    input.scope === 'hub'
      ? await planSkillImport(
          'skills',
          { prefer: input.prefer, allowUninitialized: true },
          selectedContext,
        )
      : null;
  const discovery = workspace ? await discoverMemory(root, workspace, !initialized) : null;
  const registry = workspace ? (await memoryRegistry(root, !initialized)).registry : null;
  const projectId = workspace
    ? (registry?.projects.find((entry) => entry.checkouts.some((item) => item.path === workspace))
        ?.id ??
      `${
        path
          .basename(workspace)
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '')
          .slice(0, 40) || 'project'
      }-${hash(workspace).slice(0, 8)}`)
    : null;
  const native =
    discovery?.sources.filter(
      (source) =>
        ids.includes(source.client) &&
        source.format === 'markdown' &&
        (source.project === workspace ||
          (discovery.project !== null && source.projectId === discovery.project)),
    ) ?? [];
  const guards = await setupGuards({
    root,
    scope: input.scope,
    automation: options.automation === true,
    clients,
    sources,
    workspace,
    ids,
    native,
  });
  const steps = setupSteps({
    scope: input.scope,
    init,
    mcp,
    skills,
    ids,
    workspace,
    projectId,
    native,
    automation: options.automation === true,
  });
  // Existing delivery conflicts are useful before the collection stages run.
  // New imports can introduce additional rows; final delivery still rebuilds each guarded plan.
  const deliveryRevisions: string[] = [];
  if (
    input.scope === 'hub' &&
    initialized &&
    (await readOptionalText(path.join(root, 'mcp/servers.yaml'))) !== null
  ) {
    for (const client of ids) {
      const current = await planSync({ client });
      deliveryRevisions.push(current.revision);
      const rows = publicSyncPlan(current).files.flatMap((file) => [
        ...(file.problem ? [{ name: file.client, action: 'conflict', note: file.problem }] : []),
        ...file.rows.map(({ name, action, note }) => ({ name, action, note, client })),
      ]);
      const reviews = reviewRows(rows);
      if (reviews.length)
        steps.push({
          id: `existing-mcp:${client}`,
          title: `Existing MCP conflicts: ${client}`,
          status: 'review',
          rows: reviews,
          note: 'Known before collection. New imports can change the final delivery plan.',
        });
    }
  }
  const args = [
    ...(workspace ? ['project', 'connect', workspace] : ['quick']),
    '--at',
    at,
    ...(ids.length ? ['--client', ids.join(',')] : []),
    ...(options.prefer ? ['--prefer', options.prefer] : []),
    ...(workspace && !options.automation ? ['--no-automation'] : []),
  ];
  const checkoutBinding = workspace ? await memoryCheckoutBinding(workspace) : null;
  const revision = hash(
    stableStringify({
      root,
      options,
      guards,
      projectId,
      checkoutBinding,
      discovery,
      deliveryRevisions,
      import: mcp?.revision,
      skills: skills?.revision,
      init: init?.revision,
      node: process.execPath,
      cli: cliPath,
    }),
  );
  const command = (args: string[]) =>
    hubCommand({ root, node: process.execPath, cli: cliPath }, args);
  const publicPlan = {
    scope: input.scope,
    root,
    workspace,
    projectId,
    clients: ids,
    at,
    revision,
    blocked: !ids.length,
    steps,
    warnings: discovery?.warnings ?? [],
    recovery:
      'Each writing stage keeps its existing recovery guarantees. The workflow records a guarded undo snapshot before writing. Undo returns to before this run; reset returns to the first Hub baseline.',
    commands: {
      dryRun: command([...args, '--dry-run']),
      apply: command([...args, '--apply', '--expect', revision]),
      reset: command(['reset', '--dry-run']),
    },
  };
  return { publicPlan, options, selectedContext, context, sources, mcp, skills, native, guards };
}
export type SetupPlan = Awaited<ReturnType<typeof planSetup>>;
