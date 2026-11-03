import path from 'node:path';
import { CLIENT_IDS, type ClientId } from './types.js';
import { listSkills } from './fs.js';
import { readSettings } from './settings.js';
import { defaultContentContext, type ContentContext } from './content-context.js';
import { inspectArtifact, type ArtifactSnapshot } from './artifacts.js';
import { managedPlan, type ArtifactRequest, type ManagedRow } from './managed-plan.js';
import { reservedSkill } from '../adapters/policies.js';
import { HubError } from './errors.js';
import {
  validSkillName,
  assertSkillName,
  assertPortableSkillName,
  readSkillBundle,
  linkedSkillDirectory,
} from './skill-bundle.js';

export async function planSkillImport(
  item = 'skills',
  options: {
    source?: ClientId;
    prefer?: string;
    overwrite?: boolean;
    allowUninitialized?: boolean;
  } = {},
  supplied?: ContentContext,
) {
  if (options.source && !CLIENT_IDS.includes(options.source))
    throw new HubError('Unknown source client.');
  const context = supplied ?? (await defaultContentContext());
  const settings = await readSettings(context.root, options.allowUninitialized);
  const selected = item.includes(':') ? item.slice(item.indexOf(':') + 1) : undefined;
  if (selected) assertSkillName(selected);
  const priority = options.prefer?.split(',').map((value) => value.trim()) ?? [];
  if (priority.some((value) => !CLIENT_IDS.includes(value as ClientId)))
    throw new HubError('Unknown import source preference.');
  const candidates = new Map<string, { client: ClientId; source: ArtifactSnapshot }[]>();
  const rows: ManagedRow[] = [];
  for (const client of context.clients.filter(
    (client) =>
      client.installed &&
      settings.clients?.[client.id]?.enabled !== false &&
      (!options.source || client.id === options.source),
  ))
    for (const directory of [...new Set([client.skills, ...client.additionalSkills])]) {
      for (const entry of await listSkills(directory)) {
        if (reservedSkill(client.id, entry.name)) continue;
        if (selected && entry.name !== selected) continue;
        if (!validSkillName(entry.name) || !entry.hasSkillMd || !entry.realPath) {
          rows.push({
            path: entry.path,
            client: client.id,
            name: entry.name,
            action: 'conflict',
            note: 'Invalid name, missing SKILL.md or broken skill link.',
          });
          continue;
        }
        let source;
        try {
          source = await readSkillBundle(entry.realPath);
        } catch {
          rows.push({
            path: entry.path,
            client: client.id,
            name: entry.name,
            action: 'conflict',
            note: 'Skill is not a readable, self-contained directory.',
          });
          continue;
        }
        const entries = candidates.get(entry.name) ?? [];
        if (
          !entries.some(
            (entry) =>
              entry.client === client.id && entry.source.physicalPath === source.physicalPath,
          )
        )
          entries.push({ client: client.id, source });
        candidates.set(entry.name, entries);
      }
    }
  const requests: ArtifactRequest[] = [];
  const sources: ArtifactSnapshot[] = [];
  for (const [name, entries] of candidates) {
    await assertPortableSkillName(context.root, name);
    const before = await inspectArtifact(path.join(context.root, 'skills', name));
    entries.sort(
      (left, right) =>
        (priority.includes(left.client) ? priority.indexOf(left.client) : 100) -
        (priority.includes(right.client) ? priority.indexOf(right.client) : 100),
    );
    const chosen = entries[0]!;
    sources.push(...entries.map((entry) => entry.source));
    const differing = new Set(entries.map((entry) => entry.source.fingerprint)).size > 1;
    const conflict = differing && !priority.includes(chosen.client);
    const existing = (await linkedSkillDirectory(before)) ?? before;
    const same =
      existing.fingerprint === chosen.source.fingerprint ||
      existing.physicalPath === chosen.source.physicalPath;
    const skip = before.kind !== 'missing' && !same && !options.overwrite;
    rows.push({
      path: before.path,
      client: chosen.client,
      name,
      action: same
        ? 'keep'
        : skip
          ? 'preserve'
          : conflict
            ? 'conflict'
            : before.kind === 'missing'
              ? 'add'
              : 'replace',
      note: conflict
        ? 'Client copies differ. Choose --prefer before importing.'
        : skip
          ? 'Existing hub skill preserved; --overwrite requires review.'
          : `Source: ${chosen.client}; copies scripts and assets without executing them.`,
    });
    if (!same && !skip && !conflict)
      requests.push({ before, client: 'hub', value: { kind: 'copy', source: chosen.source } });
  }
  if (selected && !candidates.has(selected) && !rows.some((row) => row.name === selected))
    throw new HubError('That skill was not found in the enabled clients.');
  const folded = new Set<string>();
  for (const name of candidates.keys()) {
    if (folded.has(name.toLowerCase()))
      rows.push({
        path: context.root,
        name,
        client: 'hub',
        action: 'conflict',
        note: 'Skill names collide on a case-insensitive filesystem.',
      });
    folded.add(name.toLowerCase());
  }
  return managedPlan(
    {
      root: context.root,
      rows,
      requests,
      sources,
      command: [
        'import',
        item,
        ...(options.source ? ['--source', options.source] : []),
        ...(options.prefer ? ['--prefer', options.prefer] : []),
        ...(options.overwrite ? ['--overwrite'] : []),
      ],
    },
    { settings, context },
  );
}
