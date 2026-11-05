import { appManaged, CODEX_POLICY_KEYS } from '../../../adapters/policies.js';
import { HubError } from '../../../shared/errors.js';
import { snapshot } from '../../../shared/file-store.js';
import { editDefinitions, readDefinitions, type Definition } from '../config-edit.js';
import { definitionSignature, desiredSignature } from '../imported-definitions.js';
import { normalize } from '../importer.js';
import { definitionHash, launchCommand, projection, semantic } from './definitions.js';
import type {
  Ownership,
  SyncContext,
  SyncOptions,
  SyncRow,
  SyncTarget,
  TargetPlan,
} from './types.js';

import type { Registry } from '../../configuration/registry.js';
import type { HubSettings } from '../../configuration/settings.js';
import type { ImportedDefinitions } from '../imported-definitions.js';

interface TargetInputs {
  target: SyncTarget;
  context: SyncContext;
  options: SyncOptions;
  settings: HubSettings;
  registry: Registry;
  state: Ownership;
  env: Map<string, string>;
  imported: ImportedDefinitions;
}

export async function planTarget(input: TargetInputs): Promise<TargetPlan> {
  const { target, context, options, settings, registry, state, env, imported } = input;

  const managed = target.installed && settings.clients?.[target.id]?.enabled !== false;
  const snap = managed
    ? await snapshot(target.file)
    : { file: target.file, realFile: target.file, content: null, mode: 0o600 };
  const rows: SyncRow[] = [];
  const owned: Record<string, string> = {};
  const planned: TargetPlan = { target, snapshot: snap, next: snap.content ?? '', rows, owned };

  if (!target.installed || settings.clients?.[target.id]?.enabled === false) {
    rows.push({
      name: '*',
      action: 'skip',
      note: target.installed ? 'Disabled in hub.yaml' : 'Client not installed',
    });
    return planned;
  }
  const previous =
    state.clients[target.id]?.file === target.file ? state.clients[target.id]!.entries : {};
  if (options.only)
    Object.assign(
      owned,
      Object.fromEntries(
        Object.entries(previous).filter(([name]) => !options.only!.includes(name)),
      ),
    );
  let current: Map<string, Definition>;
  try {
    current = readDefinitions(target.id, snap.content);
  } catch (e) {
    planned.problem = (e as Error).message;
    return planned;
  }
  if (options.replace?.some((name) => !current.has(name)))
    throw new HubError('A selected replacement is missing from the client. Review a new plan.');
  const changes = new Map<string, Definition | null>();
  for (const [name, server] of Object.entries(registry.servers).sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    if (options.only && !options.only.includes(name)) continue;
    if ((server.only && !server.only.includes(target.id)) || appManaged(server)) {
      rows.push({
        name,
        action: 'skip',
        note: appManaged(server)
          ? 'Managed by its application'
          : `Only for ${server.only!.join(', ')}`,
      });
      continue;
    }
    const before = current.get(name);
    if (before && appManaged(before)) {
      rows.push({ name, action: 'skip', note: 'Managed by its application' });
      continue;
    }
    const supported = [
      'type',
      'transport',
      'command',
      'args',
      'env',
      'cwd',
      'url',
      'headers',
      'http_headers',
      'bearer_token_env_var',
      'serverName',
      ...(target.id === 'codex' ? CODEX_POLICY_KEYS : []),
    ];
    const unknown = before ? Object.keys(before).filter((k) => !supported.includes(k)) : [];
    if (unknown.length) {
      rows.push({
        name,
        action: 'conflict',
        note: `Unsupported client settings need review: ${unknown.join(', ')}`,
      });
      continue;
    }
    const refs = [...JSON.stringify(server).matchAll(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g)].map(
      (m) => m[1],
    );
    const missing = [...new Set(refs.filter((k) => !env.has(k) && process.env[k] === undefined))];
    if ((!server.command && !server.url) || missing.length) {
      rows.push({
        name,
        action: 'conflict',
        note: missing.length
          ? `Missing variables: ${missing.join(', ')}`
          : 'Server has no command or URL',
      });
      continue;
    }
    const desired = projection(target.id, name, server, before, context);
    const already = before && definitionHash(before) === definitionHash(desired);
    const matches = before && semantic(normalize(target.id, before), env) === semantic(server, env);
    const ownedUnchanged = before && previous[name] === definitionHash(before);
    const reviewed = imported.servers[name];
    const importedUnchanged =
      before &&
      reviewed?.desired === desiredSignature(server, env) &&
      reviewed.clients[target.id] === definitionSignature(before);
    const explicitReplacement = options.replace?.includes(name) === true;
    if (
      before &&
      !already &&
      !matches &&
      !ownedUnchanged &&
      !importedUnchanged &&
      !explicitReplacement
    ) {
      rows.push({
        name,
        action: 'conflict',
        note: 'Client definition differs from hub. Import it or update the hub before sync.',
      });
      continue;
    }
    rows.push({
      name,
      action: already ? 'keep' : before ? 'replace' : 'add',
      ...(explicitReplacement && before && !already
        ? { note: 'Explicitly selected replacement; apply requires the reviewed revision.' }
        : {}),
      command: launchCommand(name, context),
      config: desired,
    });
    owned[name] = definitionHash(desired);
    if (!already) changes.set(name, desired);
  }
  for (const [name, before] of current) {
    if (options.only && !options.only.includes(name)) continue;
    if (rows.some((r) => r.name === name && r.action !== 'skip')) continue;
    if (previous[name]) {
      if (definitionHash(before) === previous[name]) {
        changes.set(name, null);
        rows.push({
          name,
          action: 'remove',
          note: 'Previously managed; no longer in this client scope',
        });
      } else
        rows.push({
          name,
          action: 'conflict',
          note: 'Previously managed entry was modified locally; preserved for review',
        });
    } else if (!rows.some((r) => r.name === name))
      rows.push({ name, action: 'preserve', note: 'Client-only entry; left as is' });
  }
  try {
    planned.next = editDefinitions(target.id, snap.content, changes);
  } catch (e) {
    planned.problem = (e as Error).message;
  }

  return planned;
}
