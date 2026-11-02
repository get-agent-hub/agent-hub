import { ensureBaseline, recordExpectedWrites } from './baseline.js';
import { HubError } from './errors.js';
import { isRecord } from './values.js';
import { writeTransaction } from './file-transaction.js';
import { hubCommand } from './shell.js';
import { appManaged, CODEX_POLICY_KEYS } from '../adapters/policies.js';
import { readSettings as settingsAt, dshProfile } from './settings.js';
import { parseRegistry, validServerName } from './registry.js';
import { snapshot, writeChecked, readOptionalText, type FileSnapshot } from './file-store.js';
import { withHubLock as withSyncLock } from './hub-lock.js';
import { hash, stableStringify as stable } from './values.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { adapters } from '../adapters/index.js';
import { readEnvFile } from './env.js';
import { editDefinitions, readDefinitions, type Definition } from './config-edit.js';
import { normalize } from './importer.js';
import { clientPaths, hubRoot } from './paths.js';
import type { HubServer } from './registry.js';
import type { ClientId } from './types.js';
import {
  definitionSignature,
  desiredSignature,
  readImportedDefinitions,
} from './imported-definitions.js';

export interface SyncOptions {
  client?: ClientId;
  /** Exact existing records explicitly selected for a reviewed replacement. */
  replace?: string[];
}
export interface SyncTarget {
  id: ClientId;
  label: string;
  file: string;
  installed: boolean;
}
export interface SyncContext {
  root: string;
  targets: SyncTarget[];
  node: string;
  cli: string;
}
interface Ownership {
  version: 1;
  clients: Partial<Record<ClientId, { file: string; entries: Record<string, string> }>>;
}
export interface SyncRow {
  name: string;
  action: 'add' | 'replace' | 'keep' | 'remove' | 'preserve' | 'skip' | 'conflict';
  note?: string;
  command?: string;
  config?: Definition;
}
interface TargetPlan {
  target: SyncTarget;
  snapshot: FileSnapshot;
  next: string;
  rows: SyncRow[];
  owned: Record<string, string>;
  problem?: string;
}
/** Contains original client files, potentially credentials. Never serialize this object. */
export interface SyncPlan {
  context: SyncContext;
  options: SyncOptions;
  revision: string;
  sourceRevision: string;
  targets: TargetPlan[];
  state: Ownership;
  stateBefore: string | null;
  blocked: boolean;
}

const definitionHash = (value: Definition) => hash(stable(value));
const stateFile = (root: string) => path.join(root, 'state', 'sync.json');
const CLIENTS: ClientId[] = ['dsh', 'codex', 'claude-code'];

export async function defaultSyncContext(): Promise<SyncContext> {
  const root = path.resolve(hubRoot());
  const settings = await settingsAt(root);
  const targets = await Promise.all(
    adapters.map(async (a) => {
      const detection = await a.detect();
      const profile = dshProfile(settings);
      const file =
        a.id === 'dsh'
          ? path.join(clientPaths.dshHome(), 'profiles', profile, 'cordis.patch.yml')
          : detection.paths.config;
      return { id: a.id, label: a.label, file, installed: detection.installed };
    }),
  );
  return {
    root,
    targets,
    node: process.execPath,
    cli: fileURLToPath(new URL('../../dist/cli.js', import.meta.url)),
  };
}

function substitute(value: unknown, env: Map<string, string>): unknown {
  if (typeof value === 'string')
    return value.replace(
      /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g,
      (_, k) => env.get(k) ?? process.env[k] ?? `\${${k}}`,
    );
  if (Array.isArray(value)) return value.map((v) => substitute(v, env));
  if (isRecord(value))
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, substitute(v, env)]));
  return value;
}

export function semantic(server: HubServer, env: Map<string, string>) {
  const {
    health: _h,
    clients: _c,
    only: _o,
    tags: _t,
    proxy: _p,
    transport: _tr,
    ...shared
  } = server;
  if (shared.env && !Object.keys(shared.env).length) delete shared.env;
  return stable(
    substitute(
      { transport: server.transport ?? (server.command ? 'stdio' : 'http'), ...shared },
      env,
    ),
  );
}

function projection(
  client: ClientId,
  name: string,
  server: HubServer,
  current: Definition | undefined,
  context: SyncContext,
): Definition {
  const policy: Definition = {};
  if (client === 'codex') {
    for (const key of CODEX_POLICY_KEYS) {
      const local = current?.[key];
      const imported = server.clients?.codex?.[key];
      if (local !== undefined || imported !== undefined) policy[key] = local ?? imported;
    }
  }
  const launch = {
    command: context.node,
    args: [context.cli, 'mcp', 'run', name],
    env: { AGENT_HUB_HOME: context.root },
  };
  return client === 'dsh'
    ? { serverName: name, transport: 'stdio', ...launch }
    : client === 'claude-code'
      ? { type: 'stdio', ...launch }
      : { ...policy, ...launch };
}

function launchCommand(name: string, context: SyncContext) {
  return hubCommand(context, ['mcp', 'run', name]);
}

export function isCurrentProjection(raw: Definition, name: string, root: string) {
  const cli = fileURLToPath(new URL('../../dist/cli.js', import.meta.url));
  return (
    raw.command === process.execPath &&
    stable(raw.args) === stable([cli, 'mcp', 'run', name]) &&
    isRecord(raw.env) &&
    Object.keys(raw.env).length === 1 &&
    raw.env.AGENT_HUB_HOME === path.resolve(root)
  );
}

export function syncCommand(context: SyncContext, options: SyncOptions, args: string[]) {
  return hubCommand(context, [
    'sync',
    ...(options.client ? ['--client', options.client] : []),
    ...(options.replace?.map((name) => `--replace=${name}`) ?? []),
    ...args,
  ]);
}

export async function planSync(
  options: SyncOptions = {},
  supplied?: SyncContext,
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
  const context = supplied ?? (await defaultSyncContext());
  const settings = await settingsAt(context.root);
  const registryText = await readOptionalText(path.join(context.root, 'mcp', 'servers.yaml'));
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
    const managed = target.installed && settings.clients?.[target.id]?.enabled !== false;
    const snap = managed
      ? await snapshot(target.file)
      : { file: target.file, realFile: target.file, content: null, mode: 0o600 };
    const rows: SyncRow[] = [];
    const owned: Record<string, string> = {};
    const planned: TargetPlan = { target, snapshot: snap, next: snap.content ?? '', rows, owned };
    targets.push(planned);
    if (!target.installed || settings.clients?.[target.id]?.enabled === false) {
      rows.push({
        name: '*',
        action: 'skip',
        note: target.installed ? 'Disabled in hub.yaml' : 'Client not installed',
      });
      continue;
    }
    const previous =
      state.clients[target.id]?.file === target.file ? state.clients[target.id]!.entries : {};
    let current: Map<string, Definition>;
    try {
      current = readDefinitions(target.id, snap.content);
    } catch (e) {
      planned.problem = (e as Error).message;
      continue;
    }
    if (options.replace?.some((name) => !current.has(name)))
      throw new HubError('A selected replacement is missing from the client. Review a new plan.');
    const changes = new Map<string, Definition | null>();
    for (const [name, server] of Object.entries(registry.servers).sort(([a], [b]) =>
      a.localeCompare(b),
    )) {
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
      const matches =
        before && semantic(normalize(target.id, before), env) === semantic(server, env);
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

export function publicSyncPlan(plan: SyncPlan) {
  return {
    revision: plan.revision,
    blocked: plan.blocked,
    commands: {
      dryRun: syncCommand(plan.context, plan.options, ['--dry-run']),
      apply: syncCommand(plan.context, plan.options, ['--apply', '--expect', plan.revision]),
    },
    files: plan.targets.map((t) => ({
      client: t.target.id,
      label: t.target.label,
      path: t.target.file,
      changed: t.next !== (t.snapshot.content ?? ''),
      problem: t.problem,
      rows: t.rows.map(({ config, ...row }) => ({
        ...row,
        config:
          config &&
          Object.fromEntries(
            ['serverName', 'type', 'transport', 'command', 'args', 'env']
              .filter((k) => k in config)
              .map((k) => [k, config[k]]),
          ),
        preservedSettings:
          config &&
          Object.keys(config).filter(
            (k) => !['serverName', 'type', 'transport', 'command', 'args', 'env'].includes(k),
          ),
      })),
    })),
  };
}

export interface BackupManifest {
  version: 1;
  files: {
    client: ClientId;
    file: string;
    realFile: string;
    mode: number;
    backup: string | null;
    beforeHash: string;
    afterHash: string;
  }[];
  stateAfterHash: string;
}

export async function applySync(plan: SyncPlan, expectedRevision?: string) {
  if (plan.options.replace?.length && expectedRevision !== plan.revision)
    throw new HubError('Explicit replacement requires --expect from the reviewed dry run.');
  if (plan.blocked) throw new HubError('Sync is blocked by conflicts. Review the dry run first.');
  return withSyncLock(plan.context.root, async (origin) => {
    const fresh = await planSync(plan.options, plan.context);
    if (fresh.revision !== plan.revision)
      throw new HubError('Configuration changed since the preview. Run a new dry run.');
    const changes = fresh.targets.filter((t) => t.next !== (t.snapshot.content ?? ''));
    if (!changes.length) return { changedFiles: 0, backup: null, restoreCommand: null };
    await ensureBaseline(
      plan.context.root,
      plan.context.targets.map((target) => ({
        file: target.file,
        client: target.id,
        installed: target.installed,
      })),
      origin,
    );
    const stateSnapshot = await snapshot(stateFile(plan.context.root));
    if (stateSnapshot.content !== fresh.stateBefore)
      throw new HubError('Sync state changed since planning. Run a new dry run.');
    const id = `sync-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomBytes(4).toString('hex')}`;
    const dir = path.join(plan.context.root, 'backups', id);
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    const nextState = structuredClone(fresh.state);
    for (const t of fresh.targets) {
      if (t.rows.some((r) => r.name === '*' && r.action === 'skip')) continue;
      nextState.clients[t.target.id] = { file: t.target.file, entries: t.owned };
    }
    const nextStateText = JSON.stringify(nextState, null, 2) + '\n';
    const manifest: BackupManifest = { version: 1, files: [], stateAfterHash: hash(nextStateText) };
    for (const [i, t] of changes.entries()) {
      const backup = t.snapshot.content === null ? null : `${i}.conf`;
      if (backup)
        await fs.writeFile(path.join(dir, backup), t.snapshot.content!, {
          mode: 0o600,
          flag: 'wx',
        });
      manifest.files.push({
        client: t.target.id,
        file: t.target.file,
        realFile: t.snapshot.realFile,
        mode: t.snapshot.mode,
        backup,
        beforeHash: hash(t.snapshot.content),
        afterHash: hash(t.next),
      });
    }
    await fs.writeFile(
      path.join(dir, 'state-before.json'),
      JSON.stringify({ content: fresh.stateBefore }),
      { mode: 0o600, flag: 'wx' },
    );
    await fs.writeFile(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2), {
      mode: 0o600,
      flag: 'wx',
    });
    await recordExpectedWrites(plan.context.root, [
      ...changes.map((target) => ({ before: target.snapshot, after: target.next })),
      { before: stateSnapshot, after: nextStateText },
    ]);
    try {
      await writeTransaction(
        [
          ...changes.map((target) => ({ before: target.snapshot, after: target.next })),
          { before: stateSnapshot, after: nextStateText },
        ],
        async (before, after) => {
          if (
            before.file === stateSnapshot.file &&
            (await planSync(plan.options, plan.context)).sourceRevision !== fresh.sourceRevision
          ) {
            throw new HubError('Hub inputs changed during sync. Review a new dry run.');
          }
          await writeChecked(before, after);
        },
      );
    } catch (error) {
      throw new HubError(
        `${error instanceof HubError ? error.message : 'Sync failed.'} Backup: ${dir}.`,
        { cause: error },
      );
    }
    const restoreCommand = hubCommand(plan.context, ['restore', id, '--dry-run']);
    return { changedFiles: changes.length, backup: id, restoreCommand };
  });
}
