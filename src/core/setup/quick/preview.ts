import { type ClientId } from '../../../contracts/clients.js';
import { publicImportPlan } from '../../mcp/import-plan.js';
import { publicManagedPlan, type ManagedPlan } from '../../recovery/managed-plan.js';
import { reviewRows, titles } from './review.js';
import type { QuickStep, SetupOptions } from './types.js';

import type { ImportPlan } from '../../mcp/import-plan.js';

interface PreviewInputs {
  scope: SetupOptions['scope'];
  init: ManagedPlan | null;
  mcp: ImportPlan | null;
  skills: ManagedPlan | null;
  ids: ClientId[];
  workspace: string | null;
  projectId: string | null;
  native: { path: string }[];
  automation: boolean;
}
export function setupSteps({
  scope,
  init,
  mcp,
  skills,
  ids,
  workspace,
  projectId,
  native,
  automation,
}: PreviewInputs): QuickStep[] {
  return scope === 'hub'
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
          status: automation ? 'deferred' : 'skipped',
          note: automation
            ? 'Install handlers in selected clients’ global settings, gated by this project’s policy. Hooks request evidenced learning from the active model; native trust and permissions still apply.'
            : 'No policy or hook enablement; existing automation remains unchanged.',
        },
      ];
}
