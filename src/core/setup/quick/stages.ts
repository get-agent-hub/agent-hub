import { assertArtifact } from '../../../shared/artifacts.js';
import { HubError } from '../../../shared/errors.js';
import { planContextSync } from '../../instructions/sync.js';
import { applyImport, planImport } from '../../mcp/import-plan.js';
import { applySync, planSync, publicSyncPlan } from '../../mcp/sync.js';
import { planAutomationSetup } from '../../memory/automation/setup.js';
import { planMemoryOnboarding } from '../../memory/onboarding.js';
import { planMemoryProject } from '../../projects/memory-bindings.js';
import { type ManagedPlan } from '../../recovery/managed-plan.js';
import { planSkillImport } from '../../skills/skill-import.js';
import { planSkillSync } from '../../skills/skill-sync.js';
import { planQuickInit } from '../quick-init.js';
import { planRepoInit } from '../repo-init.js';
import { reviewRows, titles } from './review.js';
import type { QuickStep } from './types.js';

import type { SetupPlan } from './plan.js';
export type ManagedStage = (
  id: string,
  title: string,
  build: () => Promise<ManagedPlan>,
) => Promise<boolean>;
export async function collectHub(fresh: SetupPlan, steps: QuickStep[], managed: ManagedStage) {
  const { root, clients } = fresh.publicPlan;
  if (fresh.publicPlan.scope === 'hub') {
    if (!(await managed('init', titles.init, () => planQuickInit(root, clients)))) return false;
    try {
      const imported = await planImport(
        'mcp',
        { prefer: fresh.options.prefer ?? '' },
        fresh.sources,
      );
      if (imported.sourceRevision !== fresh.mcp!.sourceRevision)
        throw new HubError('Client MCP sources changed during quick setup. Retry a new preview.');
      const reviews = reviewRows(imported.rows);
      const written = imported.blocked ? { imported: 0 } : await applyImport(imported);
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

  return true;
}
export async function connectProject(fresh: SetupPlan, steps: QuickStep[], managed: ManagedStage) {
  const { root, workspace, projectId, clients, at } = fresh.publicPlan;
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
}
export async function deliverShared(fresh: SetupPlan, steps: QuickStep[], managed: ManagedStage) {
  const { clients } = fresh.publicPlan;
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
}
