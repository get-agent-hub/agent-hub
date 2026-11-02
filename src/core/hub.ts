import path from 'node:path';
import { readRegistry } from './registry.js';
import { hubRoot } from './paths.js';
import { exists, listSkills } from './fs.js';
import { toMcpEntry } from './mcp.js';
import type { HubState, McpEntry } from './types.js';

export async function readHub(): Promise<HubState> {
  const root = hubRoot();
  if (!(await exists(root))) return { root, exists: false, skills: [], mcp: [] };

  const skills = await listSkills(path.join(root, 'skills'));

  const serversPath = path.join(root, 'mcp', 'servers.yaml');
  const registry = await readRegistry(serversPath);
  const mcp: McpEntry[] = Object.entries(registry.servers).map(([name, raw]) =>
    toMcpEntry(name, raw as Record<string, unknown>, `${serversPath}#servers.${name}`),
  );
  return { root, exists: true, skills, mcp };
}
