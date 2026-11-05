import path from 'node:path';
import { HubError } from '../../../shared/errors.js';
import { readOptionalText } from '../../../shared/file-store.js';
import { hash, isRecord, stableStringify as stable } from '../../../shared/values.js';
import { readEnvFile } from '../../configuration/env.js';
import { parseRegistry, validServerName } from '../../configuration/registry.js';
import { readSettings as settingsAt } from '../../configuration/settings.js';
import { readImportedDefinitions } from '../imported-definitions.js';
import { CLIENTS, defaultSyncContext, stateFile, substitute } from './definitions.js';
import type { Ownership, SyncContext, SyncOptions, SyncPlan, TargetPlan } from './types.js';

import { planTarget } from './target.js';
export async function planSync(
  options: SyncOptions = {},
  supplied?: SyncContext,
  proposedRegistryText?: string,
): Promise<SyncPlan> {
  if (options.client && !CLIENTS.includes(options.client))
    throw new HubError('Unknown client. Choose dsh, codex or claude-code.');
  if (options.replace !== undefined) {
    if (!options.client) throw new HubError('Explicit replacement requires one --client.');
    if (
      !Array.isArray(options.replace) ||
      !options.replace.length ||
      options.replace.some((name) => typeof name !== 'string' || !validServerName(name))
    )
      throw new HubError('Select valid server names for replacement.');
    options = { ...options, replace: [...new Set(options.replace)].sort() };
  }
  if (options.only !== undefined) {
    if (
      !Array.isArray(options.only) ||
      !options.only.length ||
      options.only.length > 100 ||
      options.only.some((name) => typeof name !== 'string' || !validServerName(name))
    )
      throw new HubError('Choose valid exact server names for --only.');
    options = { ...options, only: [...new Set(options.only)].sort() };
    if (options.replace?.some((name) => !options.only!.includes(name)))
      throw new HubError('Replacement names must be inside --only.');
  }
  const context = supplied ?? (await defaultSyncContext());
  const settings = await settingsAt(context.root);
  const registryText =
    proposedRegistryText ??
    (await readOptionalText(path.join(context.root, 'mcp', 'servers.yaml')));
  if (registryText === null)
    throw new HubError('No MCP registry. Run ahub import mcp before sync.');
  const registry = parseRegistry(registryText);
  if (options.replace?.some((name) => !Object.hasOwn(registry.servers, name)))
    throw new HubError('A selected replacement is not in the hub registry.');
  const stateBefore = await readOptionalText(stateFile(context.root));
  let state: Ownership;
  try {
    state = stateBefore === null ? { version: 1, clients: {} } : JSON.parse(stateBefore);
    if (state.version !== 1 || !isRecord(state.clients)) throw new Error();
    for (const c of Object.values(state.clients))
      if (
        !isRecord(c) ||
        typeof c.file !== 'string' ||
        !isRecord(c.entries) ||
        Object.values(c.entries).some((v) => typeof v !== 'string' || !/^[a-f0-9]{64}$/.test(v))
      )
        throw new Error();
  } catch {
    throw new HubError('Cannot parse sync ownership state.');
  }
  const env = await readEnvFile(path.join(context.root, '.env'));
  let imported;
  try {
    imported = await readImportedDefinitions(context.root);
  } catch {
    throw new HubError('Cannot read imported definition fingerprints.');
  }
  const selected = context.targets
    .filter((t) => !options.client || t.id === options.client)
    .sort((a, b) => CLIENTS.indexOf(a.id) - CLIENTS.indexOf(b.id));
  const targets: TargetPlan[] = [];
  for (const target of selected) {
    targets.push(
      await planTarget({ target, context, options, settings, registry, state, env, imported }),
    );
  }
  const physicalTargets = new Map<string, TargetPlan>();
  for (const target of targets) {
    if (target.rows.some((row) => row.name === '*' && row.action === 'skip')) continue;
    const previous = physicalTargets.get(target.snapshot.realFile);
    if (previous) {
      previous.problem =
        'Multiple clients resolve to the same configuration file. Separate their paths before sync.';
      target.problem = previous.problem;
    } else physicalTargets.set(target.snapshot.realFile, target);
  }
  const sourceRevision = hash(
    stable({
      settings,
      registryText,
      stateBefore,
      imported,
      env: [...env],
      resolved: substitute(registry, env),
    }),
  );
  const revision = hash(
    stable({ context, options, sourceRevision, files: targets.map((t) => t.snapshot) }),
  );
  return {
    context,
    options,
    revision,
    sourceRevision,
    targets,
    state,
    stateBefore,
    blocked: targets.some((t) => t.problem || t.rows.some((r) => r.action === 'conflict')),
  };
}
