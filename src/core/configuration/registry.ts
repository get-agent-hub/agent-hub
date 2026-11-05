import path from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { CLIENT_IDS, type ClientId } from '../../contracts/clients.js';
import { HubError } from '../../shared/errors.js';
import { readOptionalText } from '../../shared/file-store.js';
import { hubRoot } from '../../shared/paths.js';
import { isRecord } from '../../shared/values.js';

export interface HealthCheck {
  /** An unauthenticated HTTP readiness endpoint; references are resolved from the hub environment. */
  url: string;
  name?: string;
}

/** One MCP launch definition. Secrets belong in .env and are referenced with ${VARIABLE}. */
export interface HubServer {
  transport?: 'stdio' | 'http' | 'sse';
  command?: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  proxy?: boolean;
  only?: ClientId[];
  tags?: string[];
  clients?: Partial<Record<ClientId, Record<string, unknown>>>;
  health?: HealthCheck;
}
export interface Registry {
  version: 1;
  servers: Record<string, HubServer>;
}
export const registryPath = () => path.join(hubRoot(), 'mcp', 'servers.yaml');
export const envPath = () => path.join(hubRoot(), '.env');
const STRING_FIELDS = ['command', 'cwd', 'url'];
const ALLOWED_FIELDS = new Set([
  ...STRING_FIELDS,
  'transport',
  'args',
  'env',
  'headers',
  'proxy',
  'only',
  'tags',
  'clients',
  'health',
]);
const stringMap = (value: unknown) =>
  isRecord(value) && Object.values(value).every((item) => typeof item === 'string');

export function validServerName(name: string): boolean {
  return (
    name.length > 0 &&
    name.length <= 200 &&
    !['__proto__', 'constructor', 'prototype'].includes(name) &&
    !/[\r\n\0]/.test(name)
  );
}

export function parseRegistry(text: string): Registry {
  try {
    const doc: unknown = parseYaml(text);
    if (!isRecord(doc) || doc.version !== 1 || !isRecord(doc.servers)) throw new Error();
    for (const [name, server] of Object.entries(doc.servers)) {
      if (
        !validServerName(name) ||
        !isRecord(server) ||
        Object.keys(server).some((key) => !ALLOWED_FIELDS.has(key))
      )
        throw new Error();
      if (STRING_FIELDS.some((key) => server[key] !== undefined && typeof server[key] !== 'string'))
        throw new Error();
      if (
        server.transport !== undefined &&
        !['stdio', 'http', 'sse'].includes(String(server.transport))
      )
        throw new Error();
      for (const key of ['args', 'tags'])
        if (
          server[key] !== undefined &&
          (!Array.isArray(server[key]) || !server[key].every((item) => typeof item === 'string'))
        )
          throw new Error();
      for (const key of ['env', 'headers'])
        if (server[key] !== undefined && !stringMap(server[key])) throw new Error();
      if (server.proxy !== undefined && typeof server.proxy !== 'boolean') throw new Error();
      if (
        server.only !== undefined &&
        (!Array.isArray(server.only) ||
          server.only.some((id) => !CLIENT_IDS.includes(id as ClientId)))
      )
        throw new Error();
      if (
        server.clients !== undefined &&
        (!isRecord(server.clients) ||
          Object.entries(server.clients).some(
            ([id, value]) => !CLIENT_IDS.includes(id as ClientId) || !isRecord(value),
          ))
      )
        throw new Error();
      if (
        server.health !== undefined &&
        (!isRecord(server.health) ||
          typeof server.health.url !== 'string' ||
          (server.health.name !== undefined && typeof server.health.name !== 'string'))
      )
        throw new Error();
    }
    return doc as unknown as Registry;
  } catch {
    throw new HubError(
      'Cannot parse MCP registry. Check its schema; no configuration was changed.',
    );
  }
}

export async function readRegistry(file = registryPath()): Promise<Registry> {
  const text = await readOptionalText(file);
  return text === null ? { version: 1, servers: {} } : parseRegistry(text);
}

export function serializeRegistry(registry: Registry): string {
  const sorted = {
    version: 1,
    servers: Object.fromEntries(
      Object.entries(registry.servers).sort(([left], [right]) => left.localeCompare(right)),
    ),
  };
  const text =
    '# agent-hub MCP registry. Secrets reference ../.env, which must remain git-ignored.\n' +
    stringifyYaml(sorted, { lineWidth: 0 });
  parseRegistry(text);
  return text;
}

export function inferTransport(server: HubServer): 'stdio' | 'http' | 'sse' {
  return server.transport ?? (server.command ? 'stdio' : 'http');
}
