import { HubError } from '../../../shared/errors.js';
import {
  applyManagedPlan,
  publicManagedPlan,
  type ManagedPlan,
} from '../../recovery/managed-plan.js';
import { withWorkflowRecovery } from '../../recovery/workflow-recovery.js';
import { reviewRows } from './review.js';
import type { QuickStep } from './types.js';

import { planSetup, type SetupPlan } from './plan.js';
import { collectHub, connectProject, deliverShared } from './stages.js';
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
  return withWorkflowRecovery(
    plan.publicPlan.root,
    plan.publicPlan.scope,
    async () => {
      if (
        expect !== plan.publicPlan.revision ||
        (await planSetup(plan.options)).publicPlan.revision !== expect
      )
        throw new HubError('Quick inputs changed since preview. Review a new plan.');
    },
    () => applyStages(plan, expect),
  );
}
async function applyStages(plan: SetupPlan, expect: string) {
  if (expect !== plan.publicPlan.revision)
    throw new HubError('Review a current quick preview before applying.');
  const fresh = await planSetup(plan.options);
  if (fresh.publicPlan.revision !== expect)
    throw new HubError('Quick inputs changed since preview. Review a new quick plan.');
  if (fresh.publicPlan.blocked)
    throw new HubError(
      'No enabled, detected clients. Install a supported client or review hub.yaml.',
    );
  const { root, workspace, projectId, clients } = fresh.publicPlan;
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
  if (!(await collectHub(fresh, steps, managed))) return result();
  await connectProject(fresh, steps, managed);
  await deliverShared(fresh, steps, managed);
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
