import { applyManagedPlan, publicManagedPlan, type ManagedPlan } from '../core/managed-plan.js';
import { confirmReviewed, reviewMode } from './review.js';
import { HubError } from '../core/errors.js';
import { printJson, table } from '../core/output.js';
import { hubRoot } from '../core/paths.js';
import { listHubSkills, planSkillAdd, planSkillRemove } from '../core/skills.js';
import { planRepoInit } from '../core/repo-init.js';
import { CLIENT_IDS, type ClientId } from '../core/types.js';

export interface ManagedOptions {
  terminalDefault?: boolean;
  interactive?: boolean;
  apply?: boolean;
  dryRun?: boolean;
  expect?: string;
  json?: boolean;
}

export async function runManaged(build: () => Promise<ManagedPlan>, options: ManagedOptions) {
  const mode = reviewMode(options);
  const plan = await build();
  if (options.expect && options.expect !== plan.revision)
    throw new HubError('Inputs changed since preview. Review a fresh plan.');
  const preview = publicManagedPlan(plan);
  const execute = async (expect: string | undefined) => {
    const result = await applyManagedPlan(plan, build, expect);
    if (options.json) printJson({ ...preview, dryRun: false, result });
    else {
      console.log(
        `Updated ${result.changedPaths} managed path(s).${result.backup ? ` Backup: ${result.backup}` : ''}`,
      );
      if (result.restoreCommand) console.log(`Preview rollback:\n${result.restoreCommand}`);
      if (plan.requests.some((request) => CLIENT_IDS.includes(request.client as ClientId)))
        console.log('Restart affected clients to reload delivered content.');
    }
  };
  if (options.apply) return execute(options.expect);
  if (options.json) printJson({ ...preview, dryRun: true });
  else {
    console.log('Dry run. No files written.');
    console.log(
      table(
        ['item', 'client', 'action', 'path', 'note'],
        preview.rows.map((row) => [row.name, row.client, row.action, row.path, row.note ?? '']),
      ),
    );
    console.log(
      preview.blocked
        ? 'Blocked by conflicts. Review the entries above.'
        : mode === 'prompt'
          ? 'Review the plan above before confirming.'
          : `Apply this exact plan:\n${preview.commands.apply}`,
    );
  }
  if (plan.blocked) process.exitCode = 1;
  if (await confirmReviewed(options, plan.blocked)) await execute(plan.revision);
}

export async function skillListCommand(options: { json?: boolean }) {
  const skills = await listHubSkills(hubRoot());
  if (options.json) printJson({ skills });
  else
    console.log(
      table(
        ['skill', 'state', 'path'],
        skills.map((skill) => [
          skill.name,
          skill.hasSkillMd && skill.realPath ? 'ready' : 'broken',
          skill.path,
        ]),
      ),
    );
}
export const skillAddCommand = (
  source: string,
  options: ManagedOptions & { name?: string; overwrite?: boolean },
) => runManaged(() => planSkillAdd(source, options), options);
export const skillRemoveCommand = (name: string, options: ManagedOptions) =>
  runManaged(() => planSkillRemove(name), options);

export const repoInitCommand = (directory: string | undefined, options: ManagedOptions) =>
  runManaged(() => planRepoInit(directory), options);
