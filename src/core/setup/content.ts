import { CLIENT_IDS, type ClientId } from '../../contracts/clients.js';
import { HubError } from '../../shared/errors.js';
import { defaultContentContext, type ContentContext } from '../configuration/content-context.js';
import { planContextSync } from '../instructions/sync.js';
import { memoryOverview } from '../projects/catalog.js';
import { planProjectDisconnect } from '../projects/disconnect.js';
import { planSkillImport, planSkillSync, validSkillName } from '../skills/skills.js';
import { planRepoInit } from './repo-init.js';

export type ContentOperation =
  'skills-import' | 'skills-sync' | 'context-sync' | 'init-repo' | 'project-disconnect';
export interface ContentOptions {
  client?: ClientId;
  source?: ClientId;
  name?: string;
  only?: string[];
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
  if (
    !['skills-import', 'skills-sync', 'context-sync', 'init-repo', 'project-disconnect'].includes(
      operation,
    )
  )
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
  if (options.source !== undefined && !CLIENT_IDS.includes(options.source))
    throw new HubError('Choose a known source client.');
  if (
    options.name !== undefined &&
    (typeof options.name !== 'string' || !validSkillName(options.name))
  )
    throw new HubError('Choose a valid skill name.');
  const context = supplied ?? (await defaultContentContext());
  if (operation === 'project-disconnect') {
    const id = (await memoryOverview(context.root, cwd)).projectId;
    if (!id) throw new HubError('Select a connected project before disconnecting.');
    return planProjectDisconnect(context.root, id);
  }
  if (operation === 'skills-import')
    return planSkillImport(options.name ? `skills:${options.name}` : 'skills', options, context);
  if (operation === 'skills-sync') return planSkillSync(options, context);
  if (operation === 'context-sync') return planContextSync(options, context);
  return planRepoInit(cwd, context);
}
