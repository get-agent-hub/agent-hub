import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { adapters } from '../adapters/index.js';
import { inspectArtifact, assertArtifact } from './artifacts.js';
import { defaultContentContext } from './content-context.js';
import { planContextSync } from './context-sync.js';
import { HubError } from './errors.js';
import { readOptionalText } from './file-store.js';
import { applyImport, planImport, publicImportPlan } from './import-plan.js';
import { applyManagedPlan, publicManagedPlan, type ManagedPlan } from './managed-plan.js';
import { discoverMemory } from './memory-discovery.js';
import { planMemoryOnboarding } from './memory-onboarding.js';
import {
  memoryCheckout,
  memoryCheckoutBinding,
  memoryRegistry,
  planMemoryProject,
} from './memory-projects.js';
import { planAutomationSetup } from './memory-auto-setup.js';
import { hubRoot, clientPaths } from './paths.js';
import { planQuickInit } from './quick-init.js';
import { planRepoInit } from './repo-init.js';
import { readSettings } from './settings.js';
import { hubCommand } from './shell.js';
import { planSkillImport } from './skill-import.js';
import { planSkillSync } from './skill-sync.js';
import { applySync, planSync, publicSyncPlan } from './sync.js';
import { CLIENT_IDS, type ClientId } from './types.js';
import { hash, stableStringify } from './values.js';

export interface QuickOptions {
  clients?: ClientId[];
  prefer?: ClientId;
  at?: string;
}
export interface ProjectConnectOptions {
  workspace?: string;
  clients?: ClientId[];
  automation?: boolean;
  at?: string;
}
interface SetupOptions extends QuickOptions, ProjectConnectOptions {
  scope: 'hub' | 'project';
}
type ReviewRow = { name: string; action: string; note?: string; client?: string };
export interface QuickStep {
  id: string;
  title: string;
  status: 'planned' | 'deferred' | 'done' | 'unchanged' | 'review' | 'failed' | 'skipped';
  rows?: ReviewRow[];
  note?: string;
  backup?: string | null;
  restoreCommand?: string | null;
  changed?: number;
}

const cli = fileURLToPath(new URL('../../dist/cli.js', import.meta.url));
const titles = {
  init: 'Create or adopt Hub',
  mcpImport: 'Collect MCP definitions and protect credentials',
  skillImport: 'Collect complete skill bundles',
  project: 'Bind project memory',
  memory: 'Import existing project Markdown memory',
  automation: 'Enable project memory and install lifecycle hooks',
  delivery: 'Deliver MCP, skills and shared context to clients',
};
const reviewRows = (rows: ReviewRow[]) =>
  rows.filter(
    (row) =>
      ['conflict', 'error'].includes(row.action) ||
      (row.action === 'preserve' && row.client === 'memory'),
  );

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
async function planSetup(input: SetupOptions) {
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
  const files = (
    input.scope === 'hub'
      ? [
          'hub.yaml',
          '.env',
          '.gitignore',
          'mcp/servers.yaml',
          'skills',
          'instructions',
          'memory/MEMORY.md',
          'state/imported-definitions.json',
          'state/sync.json',
          'state/skills.json',
          'state/context.json',
        ]
      : ['hub.yaml', 'memory', 'state/repositories.json', 'templates/repo']
  ).map((file) => path.join(root, file));
  if (input.scope === 'hub') {
    for (const client of clients)
      files.push(client.skills, ...client.additionalSkills, client.instructions);
    const detected = await Promise.all(sources.map((source) => source.detect()));
    files.push(
      ...detected.flatMap((entry) =>
        Object.values(entry.paths).filter((file) =>
          ['.json', '.toml', '.yaml', '.yml'].includes(path.extname(file)),
        ),
      ),
    );
  } else if (options.automation && ids.includes('dsh')) {
    const dsh = await adapters.find((adapter) => adapter.id === 'dsh')!.detect();
    if (dsh.paths.profilePatch) files.push(dsh.paths.profilePatch);
  }
  if (options.automation && workspace) {
    if (ids.includes('claude-code'))
      files.push(path.join(clientPaths.claudeHome(), 'settings.json'));
    if (ids.includes('codex')) files.push(path.join(clientPaths.codexHome(), 'hooks.json'));
    if (ids.includes('dsh'))
      files.push(path.join(clientPaths.dshHome(), 'hooks', 'agent-hub-memory.json'));
  }
  if (workspace)
    files.push(
      ...['AGENTS.md', 'CLAUDE.md', '.agents/state/PROJECT.md', '.agents/state/NOW.md'].map(
        (file) => path.join(workspace!, file),
      ),
    );
  files.push(...native.map((source) => source.path));
  const guards = await Promise.all([...new Set(files)].sort().map((file) => inspectArtifact(file)));
  const steps: QuickStep[] =
    input.scope === 'hub'
      ? [
          {
            id: 'init',
            title: titles.init,
            status: 'planned',
            rows: publicManagedPlan(init!).rows,
          },
          {
            id: 'mcpImport',
            title: titles.mcpImport,
            status: reviewRows(mcp!.rows).length ? 'review' : 'planned',
            rows: publicImportPlan(mcp!).servers,
          },
          {
            id: 'skillImport',
            title: titles.skillImport,
            status: skills!.blocked ? 'review' : 'planned',
            rows: publicManagedPlan(skills!).rows,
          },
          {
            id: 'delivery',
            title: titles.delivery,
            status: 'deferred',
            note: `Global client settings: ${ids.join(', ') || 'no detected clients'}. Delivery is rebuilt after collection; a blocked area stays untouched.`,
          },
        ]
      : [
          {
            id: 'project',
            title: titles.project,
            status: 'deferred',
            note: `Project: ${workspace}. Memory ID: ${projectId}. Existing notes are preserved. Global MCP, skills and shared instructions are not synchronized.`,
          },
          {
            id: 'repo',
            title: 'Prepare repository handoff files',
            status: 'deferred',
            note: 'Create missing context files and preserve existing repository instructions and notes.',
          },
          {
            id: 'memory',
            title: titles.memory,
            status: native.length ? 'deferred' : 'skipped',
            note: `${native.length} project-matched Markdown source(s). Unknown projects and SQLite stores require separate review.`,
          },
          {
            id: 'automation',
            title: titles.automation,
            status: options.automation ? 'deferred' : 'skipped',
            note: options.automation
              ? 'Install handlers in selected clients’ global settings, gated by this project’s policy. Hooks request evidenced learning from the active model; native trust and permissions still apply.'
              : 'No policy or hook enablement; existing automation remains unchanged.',
          },
        ];
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
      cli,
    }),
  );
  const command = (args: string[]) => hubCommand({ root, node: process.execPath, cli }, args);
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
      'Each writing stage keeps its existing recovery guarantees. This workflow is not one transaction. Reset returns to the first Hub baseline, which may predate this run.',
    commands: {
      dryRun: command([...args, '--dry-run']),
      apply: command([...args, '--apply', '--expect', revision]),
      reset: command(['reset', '--dry-run']),
    },
  };
  return { publicPlan, options, selectedContext, context, sources, mcp, skills, native, guards };
}

type SetupPlan = Awaited<ReturnType<typeof planSetup>>;
export function applyQuick(plan: SetupPlan, expect: string) {
  if (plan.publicPlan.scope !== 'hub')
    throw new HubError('Use the project connection apply operation for this preview.');
  return applySetup(plan, expect);
}
export function applyProjectConnect(plan: SetupPlan, expect: string) {
  if (plan.publicPlan.scope !== 'project')
    throw new HubError('Use quick apply for this Hub preview.');
  return applySetup(plan, expect);
}

async function applySetup(plan: SetupPlan, expect: string) {
  if (expect !== plan.publicPlan.revision)
    throw new HubError('Review a current quick preview before applying.');
  const fresh = await planSetup(plan.options);
  if (fresh.publicPlan.revision !== expect)
    throw new HubError('Quick inputs changed since preview. Review a new quick plan.');
  if (fresh.publicPlan.blocked)
    throw new HubError(
      'No enabled, detected clients. Install a supported client or review hub.yaml.',
    );
  const { root, workspace, projectId, clients, at } = fresh.publicPlan;
  const steps: QuickStep[] = [];
  async function managed(id: string, title: string, build: () => Promise<ManagedPlan>) {
    try {
      const current = await build();
      if (current.blocked) {
        steps.push({
          id,
          title,
          status: 'review',
          rows: reviewRows(publicManagedPlan(current).rows),
          note: 'No writes in this stage. Use the individual command to resolve conflicts.',
        });
        return false;
      }
      const result = await applyManagedPlan(current, build, current.revision);
      const reviews = reviewRows(current.rows);
      steps.push({
        id,
        title,
        status: reviews.length ? 'review' : result.changedPaths ? 'done' : 'unchanged',
        rows: reviews,
        changed: result.changedPaths,
        ...result,
      });
      return true;
    } catch (error) {
      steps.push({
        id,
        title,
        status: 'failed',
        note: error instanceof Error ? error.message : 'Stage failed.',
      });
      return false;
    }
  }
  if (fresh.publicPlan.scope === 'hub') {
    if (!(await managed('init', titles.init, () => planQuickInit(root, clients)))) return result();
    try {
      const imported = await planImport(
        'mcp',
        { prefer: fresh.options.prefer ?? '' },
        fresh.sources,
      );
      if (imported.sourceRevision !== fresh.mcp!.sourceRevision)
        throw new HubError('Client MCP sources changed during quick setup. Retry a new preview.');
      const reviews = reviewRows(imported.rows);
      const written = await applyImport(imported);
      steps.push({
        id: 'mcpImport',
        title: titles.mcpImport,
        status: reviews.length ? 'review' : written.imported ? 'done' : 'unchanged',
        rows: reviews,
        changed: written.imported,
        note: 'Original Hub and client files are covered by the first-baseline reset. MCP import has no individual restore backup.',
      });
    } catch (error) {
      steps.push({
        id: 'mcpImport',
        title: titles.mcpImport,
        status: 'failed',
        note: error instanceof Error ? error.message : 'MCP import failed.',
      });
    }
    await managed('skillImport', titles.skillImport, async () => {
      for (const source of fresh.skills!.sources) await assertArtifact(source);
      return planSkillImport('skills', { prefer: fresh.options.prefer }, fresh.selectedContext);
    });
  }
  if (workspace && projectId) {
    const bound = await managed('project', 'Bind project memory', () =>
      planMemoryProject(root, projectId, workspace),
    );
    await managed('repo', 'Prepare repository handoff files', () =>
      planRepoInit(workspace, fresh.selectedContext),
    );
    if (bound) {
      if (fresh.native.length)
        await managed('memory', titles.memory, async () => {
          for (const source of fresh.native) {
            const guard = fresh.guards.find((guard) => guard.path === source.path);
            if (guard) await assertArtifact(guard);
          }
          return planMemoryOnboarding(root, workspace, at, {
            sources: fresh.native.map((source) => source.id),
            follow: fresh.options.automation,
          });
        });
      else
        steps.push({
          id: 'memory',
          title: titles.memory,
          status: 'skipped',
          note: 'No project-matched Markdown notes. New session knowledge can still be captured when automation is enabled.',
        });
      if (fresh.options.automation)
        for (const client of clients)
          await managed(`automation:${client}`, `Enable memory automation: ${client}`, () =>
            planAutomationSetup(root, workspace, client),
          );
    }
  }
  for (const client of fresh.publicPlan.scope === 'hub' ? clients : []) {
    await managed(`skills:${client}`, `Deliver skills: ${client}`, () =>
      planSkillSync({ client }, fresh.context),
    );
    await managed(`context:${client}`, `Deliver shared context: ${client}`, () =>
      planContextSync({ client }, fresh.context),
    );
    try {
      const current = await planSync({ client });
      if (current.blocked) {
        steps.push({
          id: `mcp:${client}`,
          title: `Deliver MCP: ${client}`,
          status: 'review',
          rows: publicSyncPlan(current).files.flatMap((target) => reviewRows(target.rows)),
          note: 'No MCP writes for this client. Review sync --client conflicts separately.',
        });
      } else {
        const written = await applySync(current, current.revision);
        steps.push({
          id: `mcp:${client}`,
          title: `Deliver MCP: ${client}`,
          status: written.changedFiles ? 'done' : 'unchanged',
          changed: written.changedFiles,
          ...written,
        });
      }
    } catch (error) {
      steps.push({
        id: `mcp:${client}`,
        title: `Deliver MCP: ${client}`,
        status: 'failed',
        note: error instanceof Error ? error.message : 'MCP delivery failed.',
      });
    }
  }
  return result();

  function result() {
    return {
      status: steps.some((step) => ['review', 'failed'].includes(step.status))
        ? 'needs-review'
        : 'complete',
      scope: fresh.publicPlan.scope,
      root,
      workspace,
      projectId,
      clients,
      steps,
      next:
        fresh.publicPlan.scope === 'hub'
          ? [
              'Restart client sessions and review their native trust/permission prompts.',
              'Run ahub doctor to check MCP connectivity; quick does not start external servers.',
              'Project memory is optional. Use ahub project connect <directory> when you want to enable it for a Git project.',
            ]
          : [
              'Restart the selected clients and review their native hook trust/permission prompts.',
              'Project memory uses project-gated hooks. A standalone Memory MCP server remains an optional, separately configured connection.',
              'Global MCP, skills and shared instruction delivery were not run. Use ahub quick to manage the shared Hub.',
            ],
      recovery: fresh.publicPlan.recovery,
      resetCommand: fresh.publicPlan.commands.reset,
    };
  }
}
