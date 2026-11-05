import path from 'node:path';
import { inspectArtifact } from '../../shared/artifacts.js';
import { HubError } from '../../shared/errors.js';
import { expandHome } from '../../shared/paths.js';
import { defaultContentContext, type ContentContext } from '../configuration/content-context.js';
import { readSettings } from '../configuration/settings.js';
import { managedPlan, type ArtifactRequest, type ManagedRow } from '../recovery/managed-plan.js';
import {
  assertPortableSkillName,
  assertSkillName,
  linkedSkillDirectory,
  readSkillBundle,
} from './skill-bundle.js';

export { listHubSkills, validSkillName } from './skill-bundle.js';
export { planSkillImport } from './skill-import.js';
export { planSkillSync } from './skill-sync.js';

export async function planSkillAdd(
  source: string,
  options: { name?: string; overwrite?: boolean } = {},
  supplied?: ContentContext,
) {
  const context = supplied ?? (await defaultContentContext());
  await readSettings(context.root);
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(source))
    throw new HubError(
      'skill add accepts local paths. Install remote skills with your trusted skills CLI, then import them.',
    );
  let input = path.resolve(expandHome(source));
  if (path.basename(input) === 'SKILL.md') input = path.dirname(input);
  const name = options.name ?? path.basename(input);
  assertSkillName(name);
  await assertPortableSkillName(context.root, name);
  const original = await readSkillBundle(input);
  const before = await inspectArtifact(path.join(context.root, 'skills', name));
  const existing = (await linkedSkillDirectory(before)) ?? before;
  const same =
    existing.fingerprint === original.fingerprint ||
    existing.physicalPath === original.physicalPath;
  const conflict = !same && before.kind !== 'missing' && !options.overwrite;
  const row: ManagedRow = {
    path: before.path,
    client: 'hub',
    name,
    action: same ? 'keep' : conflict ? 'conflict' : before.kind === 'missing' ? 'add' : 'replace',
    note: conflict
      ? 'Hub skill exists. Review --overwrite explicitly.'
      : 'Copies the whole skill; client directories are unchanged.',
  };
  const requests: ArtifactRequest[] =
    same || conflict ? [] : [{ before, client: 'hub', value: { kind: 'copy', source: original } }];
  return managedPlan({
    root: context.root,
    rows: [row],
    requests,
    sources: [original],
    command: [
      'skill',
      'add',
      input,
      ...(options.name ? ['--name', options.name] : []),
      ...(options.overwrite ? ['--overwrite'] : []),
    ],
  });
}

export async function planSkillRemove(name: string, supplied?: ContentContext) {
  assertSkillName(name);
  const context = supplied ?? (await defaultContentContext());
  await readSettings(context.root);
  const before = await inspectArtifact(path.join(context.root, 'skills', name));
  return managedPlan({
    root: context.root,
    rows: [
      {
        path: before.path,
        client: 'hub',
        name,
        action: before.kind === 'missing' ? 'keep' : 'remove',
        note: 'Retains a backup; sync skills afterwards to remove unchanged managed client links.',
      },
    ],
    requests:
      before.kind === 'missing' ? [] : [{ before, client: 'hub', value: { kind: 'missing' } }],
    sources: [],
    command: ['skill', 'rm', name],
  });
}
