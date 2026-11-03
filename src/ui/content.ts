import { planSkillImport, planSkillSync, validSkillName } from '../core/skills.js';
import { planContextSync } from '../core/context-sync.js';
import { planRepoInit } from '../core/repo-init.js';
import { defaultContentContext, type ContentContext } from '../core/content-context.js';
import { CLIENT_IDS, type ClientId } from '../core/types.js';
import { HubError } from '../core/errors.js';

export type ContentOperation = 'skills-import' | 'skills-sync' | 'context-sync' | 'init-repo';
export interface ContentOptions {
  client?: ClientId;
  prefer?: string;
  overwrite?: boolean;
  replace?: string[];
}

export async function planContent(
  operation: ContentOperation,
  options: ContentOptions = {},
  cwd = process.cwd(),
  supplied?: ContentContext,
) {
  if (!['skills-import', 'skills-sync', 'context-sync', 'init-repo'].includes(operation))
    throw new HubError('Choose an available content operation.');
  if (options.client !== undefined && !CLIENT_IDS.includes(options.client))
    throw new HubError('Choose a known client.');
  if (
    options.prefer !== undefined &&
    !options.prefer.split(',').every((client) => CLIENT_IDS.includes(client as ClientId))
  )
    throw new HubError('Choose a known source preference.');
  if (options.overwrite !== undefined && typeof options.overwrite !== 'boolean')
    throw new HubError('Overwrite must be a boolean.');
  if (
    options.replace !== undefined &&
    (!Array.isArray(options.replace) ||
      options.replace.length > 100 ||
      options.replace.some((name) => typeof name !== 'string' || !validSkillName(name)))
  )
    throw new HubError('Choose valid skill replacement names.');
  const context = supplied ?? (await defaultContentContext());
  if (operation === 'skills-import') return planSkillImport('skills', options, context);
  if (operation === 'skills-sync') return planSkillSync(options, context);
  if (operation === 'context-sync') return planContextSync(options, context);
  return planRepoInit(cwd, context);
}
