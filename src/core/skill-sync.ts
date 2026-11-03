import path from 'node:path';
import { CLIENT_IDS, type ClientId } from './types.js';
import { readSettings } from './settings.js';
import { readOptionalText } from './file-store.js';
import { defaultContentContext, type ContentContext } from './content-context.js';
import { containsPath, inspectArtifact, type ArtifactSnapshot } from './artifacts.js';
import { managedPlan, type ArtifactRequest, type ManagedRow } from './managed-plan.js';
import { hash, stableStringify } from './values.js';
import { reservedSkill } from '../adapters/policies.js';
import { HubError } from './errors.js';
import {
  validSkillName,
  assertSkillName,
  listHubSkills,
  readSkillBundle,
  readSkillMetadata,
  linkedSkillDirectory,
} from './skill-bundle.js';

interface SkillOwnership {
  version: 1;
  entries: {
    path: string;
    name: string;
    target: string;
    fingerprint: string;
    clients: ClientId[];
  }[];
}

async function readOwnership(root: string): Promise<SkillOwnership> {
  const text = await readOptionalText(path.join(root, 'state', 'skills.json'));
  if (text === null) return { version: 1, entries: [] };
  try {
    const state = JSON.parse(text) as SkillOwnership;
    if (
      state.version !== 1 ||
      !Array.isArray(state.entries) ||
      state.entries.some(
        (entry) =>
          !path.isAbsolute(entry.path) ||
          !path.isAbsolute(entry.target) ||
          !validSkillName(entry.name) ||
          !/^[a-f0-9]{64}$/.test(entry.fingerprint) ||
          !Array.isArray(entry.clients) ||
          entry.clients.some((client) => !CLIENT_IDS.includes(client)),
      )
    )
      throw new Error();
    return state;
  } catch {
    throw new HubError('Cannot parse skills ownership state.');
  }
}

export async function planSkillSync(
  options: { client?: ClientId; replace?: string[]; only?: string[] } = {},
  supplied?: ContentContext,
) {
  if (options.client && !CLIENT_IDS.includes(options.client)) throw new HubError('Unknown client.');
  if (
    options.replace &&
    (!options.client ||
      !options.replace.length ||
      options.replace.some((name) => !validSkillName(name)))
  )
    throw new HubError('Skills replacement requires exact names and one --client.');
  if (
    options.only !== undefined &&
    (!Array.isArray(options.only) ||
      !options.only.length ||
      options.only.length > 100 ||
      options.only.some((name) => typeof name !== 'string' || !validSkillName(name)))
  )
    throw new HubError('Choose valid exact skill names for --only.');
  if (options.only && options.replace?.some((name) => !options.only!.includes(name)))
    throw new HubError('Replacement names must be inside --only.');
  const context = supplied ?? (await defaultContentContext());
  const settings = await readSettings(context.root);
  const hubSkills = await listHubSkills(context.root);
  if (new Set(hubSkills.map((entry) => entry.name.toLowerCase())).size !== hubSkills.length)
    throw new HubError('Hub skill names collide on case-insensitive filesystems.');
  const ownership = await readOwnership(context.root);
  const next = new Map(ownership.entries.map((entry) => [entry.path, entry]));
  const sources: ArtifactSnapshot[] = [];
  const linkedSources: ArtifactSnapshot[] = [];
  const requests: ArtifactRequest[] = [];
  const rows: ManagedRow[] = [];
  if (options.replace?.some((name) => !hubSkills.some((entry) => entry.name === name)))
    throw new HubError('A replacement skill is not in the hub.');
  const groups = new Map<
    string,
    { file: string; clients: typeof context.clients; primary: Set<ClientId> }
  >();
  for (const client of context.clients) {
    for (const [index, directory] of [
      ...new Set([client.skills, ...client.additionalSkills]),
    ].entries()) {
      const marker = await inspectArtifact(path.join(directory, '.agent-hub-path-probe'));
      const physical = path.dirname(marker.physicalPath);
      const group = groups.get(physical) ?? {
        file: directory,
        clients: [],
        primary: new Set<ClientId>(),
      };
      if (!group.clients.some((entry) => entry.id === client.id)) group.clients.push(client);
      if (index === 0) group.primary.add(client.id);
      groups.set(physical, group);
    }
  }
  for (const group of groups.values()) {
    const selected = group.clients.filter(
      (client) =>
        (!options.client || client.id === options.client) &&
        client.installed &&
        settings.clients?.[client.id]?.enabled !== false,
    );
    if (!selected.length) continue;
    const clientLabel = group.clients
      .filter((client) => client.installed)
      .map((client) => client.id)
      .join(', ');
    const names = new Set([
      ...hubSkills.map((skill) => skill.name),
      ...ownership.entries
        .filter((entry) => path.dirname(entry.path) === group.file)
        .map((entry) => entry.name),
    ]);
    for (const name of names) {
      if (options.only && !options.only.includes(name)) continue;
      assertSkillName(name);
      const file = path.join(group.file, name);
      if (group.clients.some((client) => reservedSkill(client.id, name))) {
        rows.push({
          path: file,
          client: clientLabel,
          name,
          action: 'skip',
          note: 'Reserved client-managed skill namespace; preserved.',
        });
        continue;
      }
      const before = await inspectArtifact(file);
      const previous = next.get(file);
      if (
        before.kind === 'missing' &&
        !previous &&
        !selected.some((client) => group.primary.has(client.id))
      )
        continue;
      const skill = hubSkills.find((entry) => entry.name === name);
      const target = skill ? path.resolve(context.root, 'skills', name) : undefined;
      const row: ManagedRow = { path: file, client: clientLabel, name, action: 'keep' };
      rows.push(row);
      if (!skill) {
        if (!previous) continue;
        if (before.kind === 'missing') next.delete(file);
        else if (before.kind === 'symlink' && before.fingerprint === previous.fingerprint) {
          row.action = 'remove';
          requests.push({ before, client: clientLabel, value: { kind: 'missing' } });
          next.delete(file);
        } else {
          row.action = 'conflict';
          row.note = 'Previously managed skill changed locally; preserved.';
        }
        continue;
      }
      if (!skill.realPath || !skill.hasSkillMd || !validSkillName(name)) {
        row.action = 'conflict';
        row.note = 'Hub skill is broken or has no SKILL.md.';
        continue;
      }
      const original = await readSkillBundle(skill.realPath);
      sources.push(original);
      const metadata = await readSkillMetadata(original.path);
      if (group.clients.some((client) => reservedSkill(client.id, String(metadata?.name ?? '')))) {
        row.action = 'skip';
        row.note = 'The skill metadata uses a reserved client namespace; preserved.';
        continue;
      }
      if (
        group.clients.some(
          (client) =>
            client.id === 'codex' && client.installed && settings.clients?.codex?.enabled !== false,
        ) &&
        !(
          typeof metadata?.name === 'string' &&
          metadata.name.trim() &&
          typeof metadata.description === 'string' &&
          metadata.description.trim()
        )
      ) {
        row.action = 'conflict';
        row.note =
          'Codex requires YAML name and description in SKILL.md. Add portable metadata before delivery.';
        continue;
      }
      if (before.physicalPath === original.physicalPath) {
        row.note = 'Client already reads the hub directory.';
        continue;
      }
      const pointsToHub =
        before.kind === 'symlink' &&
        path.resolve(path.dirname(before.physicalPath), before.target!) === target;
      const owned = previous?.fingerprint === before.fingerprint && before.kind === 'symlink';
      const matchingCopy =
        before.kind === 'directory' && before.fingerprint === original.fingerprint;
      const linked = await linkedSkillDirectory(before);
      const matchingLink = linked?.fingerprint === original.fingerprint;
      if (matchingLink) linkedSources.push(linked!);
      if (
        !pointsToHub &&
        before.kind !== 'missing' &&
        !owned &&
        !matchingCopy &&
        !matchingLink &&
        !options.replace?.includes(name)
      ) {
        row.action = 'conflict';
        row.note = 'Client skill differs from Hub. Import it or review an explicit --replace.';
        continue;
      }
      if (row.action === 'conflict') continue;
      if (!pointsToHub) {
        if (
          group.clients.some(
            (client) => client.installed && settings.clients?.[client.id]?.enabled === false,
          )
        ) {
          row.action = 'conflict';
          row.note = 'A disabled client shares this skills directory.';
          continue;
        }
        row.action = before.kind === 'missing' ? 'add' : 'replace';
        row.note = matchingLink
          ? 'Replace an equivalent link with the hub link; original binding retained in backup.'
          : matchingCopy
            ? 'Replace the identical directory with a link; original retained in backup.'
            : 'Create a link to the hub original.';
        requests.push({ before, client: clientLabel, value: { kind: 'symlink', target: target! } });
      }
      // The fingerprint of a generated link is independent of its parent directory.
      const fingerprint = pointsToHub
        ? before.fingerprint
        : hash(stableStringify({ kind: 'symlink', mode: 0o777, target }));
      next.set(file, {
        path: file,
        name,
        target: target!,
        fingerprint,
        clients: group.clients.map((client) => client.id),
      });
    }
    if (
      group.clients.some(
        (client) => client.installed && settings.clients?.[client.id]?.enabled === false,
      )
    )
      for (const row of rows.filter(
        (row) =>
          path.dirname(row.path) === group.file &&
          ['add', 'replace', 'remove'].includes(row.action),
      )) {
        row.action = 'conflict';
        row.note = 'A disabled client shares this skills directory.';
      }
  }
  const statePath = path.join(context.root, 'state', 'skills.json');
  const stateBefore = await inspectArtifact(statePath);
  const nextState =
    JSON.stringify(
      {
        version: 1,
        entries: [...next.values()].sort((left, right) => left.path.localeCompare(right.path)),
      },
      null,
      2,
    ) + '\n';
  const previousText = await readOptionalText(statePath);
  if (nextState !== previousText && (next.size || ownership.entries.length))
    requests.push({
      before: stateBefore,
      client: 'hub',
      value: { kind: 'file', content: nextState, mode: 0o600 },
    });
  if (
    options.replace?.some(
      (name) => !rows.some((row) => row.name === name && ['replace', 'keep'].includes(row.action)),
    )
  )
    throw new HubError('A selected skill replacement is missing from the client or blocked.');
  return managedPlan(
    {
      root: context.root,
      rows,
      requests,
      sources: [
        ...sources,
        ...linkedSources.filter(
          (source) =>
            !requests.some((request) =>
              containsPath(request.before.physicalPath, source.physicalPath),
            ),
        ),
      ],
      command: [
        'sync',
        '--area',
        'skills',
        ...(options.client ? ['--client', options.client] : []),
        ...(options.only?.map((name) => `--only=${name}`) ?? []),
        ...(options.replace?.map((name) => `--replace=${name}`) ?? []),
      ],
    },
    { settings, context, ownership, stateBefore },
  );
}
