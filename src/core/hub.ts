import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { hubRoot } from './paths.js';
import { exists, listSkills, readText } from './fs.js';
import { toMcpEntry } from './mcp.js';
import type { HubState, McpEntry } from './types.js';

type ServersYaml = { version?: number; servers?: Record<string, Record<string, unknown>> };

export async function readHub(): Promise<HubState> {
  const root = hubRoot();
  if (!(await exists(root))) return { root, exists: false, skills: [], mcp: [] };

  const skills = await listSkills(path.join(root, 'skills'));

  const serversPath = path.join(root, 'mcp', 'servers.yaml');
  const text = await readText(serversPath);
  const mcp: McpEntry[] = [];
  if (text) {
    const doc = (parseYaml(text) ?? {}) as ServersYaml;
    for (const [name, raw] of Object.entries(doc.servers ?? {})) {
      mcp.push(toMcpEntry(name, raw, `${serversPath}#servers.${name}`));
    }
  }
  return { root, exists: true, skills, mcp };
}
