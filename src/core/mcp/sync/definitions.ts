import path from 'node:path';
import { adapters } from '../../../adapters/index.js';
import { CODEX_POLICY_KEYS } from '../../../adapters/policies.js';
import type { ClientId } from '../../../contracts/clients.js';
import { clientPaths, hubRoot } from '../../../shared/paths.js';
import { cliPath } from '../../../shared/runtime.js';
import { hubCommand } from '../../../shared/shell.js';
import { hash, isRecord, stableStringify as stable } from '../../../shared/values.js';
import type { HubServer } from '../../configuration/registry.js';
import { dshProfile, readSettings as settingsAt } from '../../configuration/settings.js';
import { type Definition } from '../config-edit.js';
import type { SyncContext, SyncOptions } from './types.js';
export const definitionHash = (value: Definition) => hash(stable(value));

export const stateFile = (root: string) => path.join(root, 'state', 'sync.json');

export const CLIENTS: ClientId[] = ['dsh', 'codex', 'claude-code'];

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
    cli: cliPath,
  };
}

export function substitute(value: unknown, env: Map<string, string>): unknown {
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

export function projection(
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

export function launchCommand(name: string, context: SyncContext) {
  return hubCommand(context, ['mcp', 'run', name]);
}

export function isCurrentProjection(raw: Definition, name: string, root: string) {
  const cli = cliPath;
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
    ...(options.only?.map((name) => `--only=${name}`) ?? []),
    ...(options.replace?.map((name) => `--replace=${name}`) ?? []),
    ...args,
  ]);
}
