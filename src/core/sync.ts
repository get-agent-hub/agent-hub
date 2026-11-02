import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { adapters } from '../adapters/index.js';
import { readEnvFile } from './env.js';
import { editDefinitions, object, readDefinitions, SyncError, type Definition } from './config-edit.js';
import { normalize } from './importer.js';
import { clientPaths, hubRoot } from './paths.js';
import type { HubServer, Registry } from './registry.js';
import type { ClientId } from './types.js';
import { definitionSignature, desiredSignature, readImportedDefinitions } from './imported-definitions.js';

export { SyncError } from './config-edit.js';
export interface SyncOptions { client?: ClientId }
export interface SyncTarget { id: ClientId; label: string; file: string; installed: boolean }
export interface SyncContext { root: string; targets: SyncTarget[]; node: string; cli: string }
interface Ownership { version: 1; clients: Partial<Record<ClientId, { file: string; entries: Record<string, string> }>> }
interface FileSnapshot { file: string; realFile: string; content: string | null; mode: number }
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

export function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (object(value)) return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stable(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
export const hash = (value: string | null) => createHash('sha256').update(value === null ? '\0missing' : value).digest('hex');
const definitionHash = (value: Definition) => hash(stable(value));
export const quoteShell = (value: string) => `'${value.replace(/'/g, `'"'"'`)}'`;
const stateFile = (root: string) => path.join(root, 'state', 'sync.json');
const CLIENTS: ClientId[] = ['dsh', 'codex', 'claude-code'];
const CODEX_POLICY = ['tools', 'startup_timeout_sec', 'tool_timeout_sec', 'enabled', 'enabled_tools', 'disabled_tools', 'env_vars', 'required', 'default_tools_approval_mode'];

async function text(file: string): Promise<string | null> {
  try { return await fs.readFile(file, 'utf8'); }
  catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null; throw new SyncError(`Cannot read ${file}.`); }
}

export async function snapshot(file: string): Promise<FileSnapshot> {
  const content = await text(file);
  if (content === null) {
    try { if ((await fs.lstat(file)).isSymbolicLink()) throw new SyncError(`Dangling config symlink: ${file}.`); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
    // An existing parent can itself be a symlink.
    let parent = path.dirname(file);
    let suffix = path.basename(file);
    while (true) {
      try { return { file, realFile: path.join(await fs.realpath(parent), suffix), content, mode: 0o600 }; }
      catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT' || path.dirname(parent) === parent) throw new SyncError(`Cannot resolve ${file}.`);
        suffix = path.join(path.basename(parent), suffix); parent = path.dirname(parent);
      }
    }
  }
  const realFile = await fs.realpath(file);
  return { file, realFile, content, mode: (await fs.stat(realFile)).mode & 0o777 };
}

export async function defaultSyncContext(): Promise<SyncContext> {
  const root = path.resolve(hubRoot());
  const settings = await settingsAt(root);
  const targets = await Promise.all(adapters.map(async (a) => {
    const detection = await a.detect();
    const profile = process.env.AGENT_HUB_DSH_PROFILE ?? settings.clients?.dsh?.profile ?? 'web';
    if (typeof profile !== 'string' || !/^[\w-]+$/.test(profile)) throw new SyncError('Invalid DSH profile name.');
    const file = a.id === 'dsh' ? path.join(clientPaths.dshHome(), 'profiles', profile, 'cordis.patch.yml') : detection.paths.config;
    return { id: a.id, label: a.label, file, installed: detection.installed };
  }));
  return { root, targets, node: process.execPath, cli: fileURLToPath(new URL('../../dist/cli.js', import.meta.url)) };
}

type Settings = { version?: number; clients?: Partial<Record<ClientId, { enabled?: boolean; profile?: string }>> };
async function settingsAt(root: string): Promise<Settings> {
  const raw = await text(path.join(root, 'hub.yaml'));
  if (raw === null) throw new SyncError('Hub is not initialized. Run ahub init first.');
  try {
    const doc = parseYaml(raw);
    if (!object(doc) || doc.version !== 1 || (doc.clients !== undefined && !object(doc.clients))) throw new Error();
    for (const c of Object.values(doc.clients ?? {})) if (!object(c) || (c.enabled !== undefined && typeof c.enabled !== 'boolean')) throw new Error();
    return doc as Settings;
  } catch { throw new SyncError('Cannot parse hub.yaml. No client files were changed.'); }
}

export function appManaged(server: HubServer | Definition) {
  return /\/(ChatGPT|Codex)\.app\//.test(String(server.command ?? ''));
}

function substitute(value: unknown, env: Map<string, string>): unknown {
  if (typeof value === 'string') return value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, k) => env.get(k) ?? process.env[k] ?? `\${${k}}`);
  if (Array.isArray(value)) return value.map((v) => substitute(v, env));
  if (object(value)) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, substitute(v, env)]));
  return value;
}

export function semantic(server: HubServer, env: Map<string, string>) {
  const { clients: _c, only: _o, tags: _t, proxy: _p, transport: _tr, ...shared } = server;
  if (shared.env && !Object.keys(shared.env).length) delete shared.env;
  return stable(substitute({ transport: server.transport ?? (server.command ? 'stdio' : 'http'), ...shared }, env));
}

function legacyProjection(raw: Definition, name: string, root: string) {
  const args = Array.isArray(raw.args) ? raw.args.map(String) : [];
  return (args.includes(path.join(root, 'bin', 'mcp-stdio-bridge.py')) && args[args.indexOf('--name') + 1] === name && args.includes('--name'))
    || (name === 'todoist' && args[0] === path.join(root, 'bin', 'todoist-proxy.zsh'));
}

function projection(client: ClientId, name: string, server: HubServer, current: Definition | undefined, context: SyncContext): Definition {
  const policy: Definition = {};
  if (client === 'codex') {
    for (const key of CODEX_POLICY) {
      const local = current?.[key];
      const imported = server.clients?.codex?.[key];
      if (local !== undefined || imported !== undefined) policy[key] = local ?? imported;
    }
  }
  const launch = { command: context.node, args: [context.cli, 'mcp', 'run', name], env: { AGENT_HUB_HOME: context.root } };
  return client === 'dsh' ? { serverName: name, transport: 'stdio', ...launch } : client === 'claude-code' ? { type: 'stdio', ...launch } : { ...policy, ...launch };
}

function launchCommand(name: string, context: SyncContext) {
  return `AGENT_HUB_HOME=${quoteShell(context.root)} ${[context.node, context.cli, 'mcp', 'run', name].map(quoteShell).join(' ')}`;
}

export function isCurrentProjection(raw: Definition, name: string, root: string) {
  const cli = fileURLToPath(new URL('../../dist/cli.js', import.meta.url));
  return raw.command === process.execPath && stable(raw.args) === stable([cli, 'mcp', 'run', name])
    && object(raw.env) && Object.keys(raw.env).length === 1 && raw.env.AGENT_HUB_HOME === path.resolve(root);
}

export function syncCommand(context: SyncContext, options: SyncOptions, args: string[]) {
  return `AGENT_HUB_HOME=${quoteShell(context.root)} ${[context.node, context.cli, 'sync', ...(options.client ? ['--client', options.client] : []), ...args].map(quoteShell).join(' ')}`;
}

export async function planSync(options: SyncOptions = {}, supplied?: SyncContext): Promise<SyncPlan> {
  if (options.client && !CLIENTS.includes(options.client)) throw new SyncError('Unknown client. Choose dsh, codex or claude-code.');
  const context = supplied ?? await defaultSyncContext();
  const settings = await settingsAt(context.root);
  const registryText = await text(path.join(context.root, 'mcp', 'servers.yaml'));
  if (registryText === null) throw new SyncError('No MCP registry. Run ahub import mcp before sync.');
  let registry: Registry;
  try {
    const parsed = parseYaml(registryText);
    if (!object(parsed) || parsed.version !== 1 || !object(parsed.servers)) throw new Error();
    for (const [name, s] of Object.entries(parsed.servers)) {
      if (!name || name.length > 200 || ['__proto__', 'constructor', 'prototype'].includes(name) || !object(s) || (s.only !== undefined && (!Array.isArray(s.only) || s.only.some((id) => !CLIENTS.includes(id))))) throw new Error();
    }
    registry = parsed as unknown as Registry;
  } catch { throw new SyncError('Cannot parse MCP registry safely. No client files were changed.'); }
  const stateBefore = await text(stateFile(context.root));
  let state: Ownership;
  try {
    state = stateBefore === null ? { version: 1, clients: {} } : JSON.parse(stateBefore);
    if (state.version !== 1 || !object(state.clients)) throw new Error();
    for (const c of Object.values(state.clients)) if (!object(c) || typeof c.file !== 'string' || !object(c.entries) || Object.values(c.entries).some((v) => typeof v !== 'string' || !/^[a-f0-9]{64}$/.test(v))) throw new Error();
  } catch { throw new SyncError('Cannot parse sync ownership state.'); }
  const env = await readEnvFile(path.join(context.root, '.env'));
  let imported;
  try { imported = await readImportedDefinitions(context.root); }
  catch { throw new SyncError('Cannot read imported definition fingerprints.'); }
  const selected = context.targets.filter((t) => !options.client || t.id === options.client).sort((a, b) => CLIENTS.indexOf(a.id) - CLIENTS.indexOf(b.id));
  const targets: TargetPlan[] = [];
  for (const target of selected) {
    const managed = target.installed && settings.clients?.[target.id]?.enabled !== false;
    const snap = managed ? await snapshot(target.file) : { file: target.file, realFile: target.file, content: null, mode: 0o600 };
    const rows: SyncRow[] = [];
    const owned: Record<string, string> = {};
    const planned: TargetPlan = { target, snapshot: snap, next: snap.content ?? '', rows, owned };
    targets.push(planned);
    if (!target.installed || settings.clients?.[target.id]?.enabled === false) {
      rows.push({ name: '*', action: 'skip', note: target.installed ? 'Disabled in hub.yaml' : 'Client not installed' });
      continue;
    }
    const previous = state.clients[target.id]?.file === target.file ? state.clients[target.id]!.entries : {};
    let current: Map<string, Definition>;
    try { current = readDefinitions(target.id, snap.content); }
    catch (e) { planned.problem = (e as Error).message; continue; }
    const changes = new Map<string, Definition | null>();
    for (const [name, server] of Object.entries(registry.servers).sort(([a], [b]) => a.localeCompare(b))) {
      if ((server.only && !server.only.includes(target.id)) || appManaged(server)) {
        rows.push({ name, action: 'skip', note: appManaged(server) ? 'Managed by its application' : `Only for ${server.only!.join(', ')}` });
        continue;
      }
      const before = current.get(name);
      if (before && appManaged(before)) { rows.push({ name, action: 'skip', note: 'Managed by its application' }); continue; }
      const supported = ['type', 'transport', 'command', 'args', 'env', 'cwd', 'url', 'headers', 'http_headers', 'bearer_token_env_var', 'serverName', ...target.id === 'codex' ? CODEX_POLICY : []];
      const unknown = before ? Object.keys(before).filter((k) => !supported.includes(k)) : [];
      if (unknown.length) { rows.push({ name, action: 'conflict', note: `Unsupported client settings need review: ${unknown.join(', ')}` }); continue; }
      const refs = [...JSON.stringify(server).matchAll(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g)].map((m) => m[1]);
      const missing = [...new Set(refs.filter((k) => !env.has(k) && process.env[k] === undefined))];
      if ((!server.command && !server.url) || missing.length) {
        rows.push({ name, action: 'conflict', note: missing.length ? `Missing variables: ${missing.join(', ')}` : 'Server has no command or URL' }); continue;
      }
      const desired = projection(target.id, name, server, before, context);
      const already = before && definitionHash(before) === definitionHash(desired);
      const matches = before && semantic(normalize(target.id, before), env) === semantic(server, env);
      const ownedUnchanged = before && previous[name] === definitionHash(before);
      const reviewed = imported.servers[name];
      const importedUnchanged = before && reviewed?.desired === desiredSignature(server, env) && reviewed.clients[target.id] === definitionSignature(before);
      const legacy = target.id === 'dsh' && before && legacyProjection(before, name, context.root);
      if (before && !already && !matches && !ownedUnchanged && !importedUnchanged && !legacy) {
        rows.push({ name, action: 'conflict', note: 'Client definition differs from hub. Import it or update the hub before sync.' }); continue;
      }
      rows.push({ name, action: already ? 'keep' : before ? 'replace' : 'add', command: launchCommand(name, context), config: desired });
      owned[name] = definitionHash(desired);
      if (!already) changes.set(name, desired);
    }
    for (const [name, before] of current) {
      if (rows.some((r) => r.name === name && r.action !== 'skip')) continue;
      if (previous[name]) {
        if (definitionHash(before) === previous[name]) { changes.set(name, null); rows.push({ name, action: 'remove', note: 'Previously managed; no longer in this client scope' }); }
        else rows.push({ name, action: 'conflict', note: 'Previously managed entry was modified locally; preserved for review' });
      } else if (!rows.some((r) => r.name === name)) rows.push({ name, action: 'preserve', note: 'Client-only entry; left as is' });
    }
    try { planned.next = editDefinitions(target.id, snap.content, changes); }
    catch (e) { planned.problem = (e as Error).message; }
  }
  const sourceRevision = hash(stable({ settings, registryText, stateBefore, imported, env: [...env], resolved: substitute(registry, env) }));
  const revision = hash(stable({ context, options, sourceRevision, files: targets.map((t) => t.snapshot) }));
  return { context, options, revision, sourceRevision, targets, state, stateBefore, blocked: targets.some((t) => t.problem || t.rows.some((r) => r.action === 'conflict')) };
}

export function publicSyncPlan(plan: SyncPlan) {
  return {
    revision: plan.revision, blocked: plan.blocked,
    commands: { dryRun: syncCommand(plan.context, plan.options, ['--dry-run']), apply: syncCommand(plan.context, plan.options, ['--apply', '--expect', plan.revision]) },
    files: plan.targets.map((t) => ({ client: t.target.id, label: t.target.label, path: t.target.file, changed: t.next !== (t.snapshot.content ?? ''), problem: t.problem, rows: t.rows.map(({ config, ...row }) => ({
      ...row,
      config: config && Object.fromEntries(['serverName', 'type', 'transport', 'command', 'args', 'env'].filter((k) => k in config).map((k) => [k, config[k]])),
      preservedSettings: config && Object.keys(config).filter((k) => !['serverName', 'type', 'transport', 'command', 'args', 'env'].includes(k)),
    })) })),
  };
}

/** Atomic file replacement, guarded against changes since planning. */
export async function writeChecked(snap: FileSnapshot, next: string | null) {
  const current = await snapshot(snap.file);
  if (current.realFile !== snap.realFile || current.content !== snap.content) throw new SyncError(`Configuration changed: ${snap.file}. Run a new dry run.`);
  if (next === null) { await fs.unlink(snap.realFile); return; }
  await fs.mkdir(path.dirname(snap.realFile), { recursive: true });
  const tmp = `${snap.realFile}.agent-hub-${randomBytes(8).toString('hex')}.tmp`;
  try {
    await fs.writeFile(tmp, next, { mode: snap.mode, flag: 'wx' });
    const latest = await snapshot(snap.file);
    if (latest.realFile !== snap.realFile || latest.content !== snap.content) throw new SyncError(`Configuration changed: ${snap.file}. Run a new dry run.`);
    await fs.rename(tmp, snap.realFile);
  } finally { await fs.unlink(tmp).catch(() => undefined); }
}

export async function withSyncLock<T>(root: string, action: () => Promise<T>) {
  const dir = path.join(root, 'state');
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, 'sync.lock');
  let lock;
  try { lock = await fs.open(file, 'wx', 0o600); }
  catch (e) { if ((e as NodeJS.ErrnoException).code === 'EEXIST') throw new SyncError('Another sync or restore is running (state/sync.lock).'); throw e; }
  try { await lock.writeFile(String(process.pid)); return await action(); }
  finally { await lock.close(); await fs.unlink(file); }
}

export interface BackupManifest {
  version: 1;
  files: { client: ClientId; file: string; realFile: string; mode: number; backup: string | null; beforeHash: string; afterHash: string }[];
  stateAfterHash: string;
}

export async function applySync(plan: SyncPlan) {
  if (plan.blocked) throw new SyncError('Sync is blocked by conflicts. Review the dry run first.');
  return withSyncLock(plan.context.root, async () => {
    const fresh = await planSync(plan.options, plan.context);
    if (fresh.revision !== plan.revision) throw new SyncError('Configuration changed since the preview. Run a new dry run.');
    const changes = fresh.targets.filter((t) => t.next !== (t.snapshot.content ?? ''));
    if (!changes.length) return { changedFiles: 0, backup: null, restoreCommand: null };
    const stateSnapshot = await snapshot(stateFile(plan.context.root));
    if (stateSnapshot.content !== fresh.stateBefore) throw new SyncError('Sync state changed since planning. Run a new dry run.');
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
      if (backup) await fs.writeFile(path.join(dir, backup), t.snapshot.content!, { mode: 0o600, flag: 'wx' });
      manifest.files.push({ client: t.target.id, file: t.target.file, realFile: t.snapshot.realFile, mode: t.snapshot.mode, backup, beforeHash: hash(t.snapshot.content), afterHash: hash(t.next) });
    }
    await fs.writeFile(path.join(dir, 'state-before.json'), JSON.stringify({ content: fresh.stateBefore }), { mode: 0o600, flag: 'wx' });
    await fs.writeFile(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2), { mode: 0o600, flag: 'wx' });
    const written: TargetPlan[] = [];
    try {
      for (const t of changes) { await writeChecked(t.snapshot, t.next); written.push(t); }
      if ((await planSync(plan.options, plan.context)).sourceRevision !== fresh.sourceRevision) throw new SyncError('Hub inputs changed during sync. Review a new dry run.');
      await writeChecked(stateSnapshot, nextStateText);
    } catch (e) {
      const failed: string[] = [];
      for (const t of written.reverse()) {
        try { await writeChecked({ ...t.snapshot, content: t.next }, t.snapshot.content); }
        catch { failed.push(t.target.id); }
      }
      if (failed.length) throw new SyncError(`Sync stopped; rollback needs review for ${failed.join(', ')}. Original files are in ${dir}.`);
      throw new SyncError(`Sync stopped and written files were rolled back. Backup: ${dir}. ${e instanceof SyncError ? e.message : 'Check file permissions.'}`);
    }
    const restoreCommand = `AGENT_HUB_HOME=${quoteShell(plan.context.root)} ${[plan.context.node, plan.context.cli, 'restore', id, '--dry-run'].map(quoteShell).join(' ')}`;
    return { changedFiles: changes.length, backup: id, restoreCommand };
  });
}
