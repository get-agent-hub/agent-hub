import fs from 'node:fs/promises';
import path from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { hubRoot } from './paths.js';
import type { ClientId } from './types.js';

/** One MCP server as stored in ~/.agent-hub/mcp/servers.yaml. Never contains literal secrets. */
export interface HubServer {
  transport?: 'stdio' | 'http' | 'sse';
  command?: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  /** Route remote (http/sse) traffic through HTTP(S)_PROXY from .env. */
  proxy?: boolean;
  /** Restrict projection to these clients (default: all). */
  only?: ClientId[];
  tags?: string[];
  /** Client-specific passthrough keys (e.g. codex tool approvals). */
  clients?: Partial<Record<ClientId, Record<string, unknown>>>;
}

export interface Registry {
  version: 1;
  servers: Record<string, HubServer>;
}

export const registryPath = () => path.join(hubRoot(), 'mcp', 'servers.yaml');
export const envPath = () => path.join(hubRoot(), '.env');

export async function readRegistry(): Promise<Registry> {
  try {
    const doc = parseYaml(await fs.readFile(registryPath(), 'utf8')) as Partial<Registry> | null;
    return { version: 1, servers: doc?.servers ?? {} };
  } catch {
    return { version: 1, servers: {} };
  }
}

const HEADER = `# agent-hub MCP registry — source of truth for all clients.
# Secrets are references (\${VAR}); values live in ../.env (git-ignored).
# Edit here, then run \`ahub sync\`.
`;

export async function writeRegistry(reg: Registry): Promise<void> {
  const sorted: Registry = {
    version: 1,
    servers: Object.fromEntries(Object.keys(reg.servers).sort().map((k) => [k, reg.servers[k]])),
  };
  await fs.mkdir(path.dirname(registryPath()), { recursive: true });
  const tmp = registryPath() + '.tmp';
  await fs.writeFile(tmp, HEADER + stringifyYaml(sorted, { lineWidth: 0 }), 'utf8');
  await fs.rename(tmp, registryPath());
}

export function inferTransport(s: HubServer): 'stdio' | 'http' | 'sse' {
  if (s.transport) return s.transport;
  return s.command ? 'stdio' : 'http';
}
