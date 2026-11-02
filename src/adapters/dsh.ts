import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { clientPaths } from '../core/paths.js';
import { exists, listSkills, readText } from '../core/fs.js';
import { toMcpEntry } from '../core/mcp.js';
import type { ClientAdapter, ClientSnapshot, DetectResult, RawMcp, SkillEntry } from '../core/types.js';

const MCP_PLUGIN = '@deepseek-ai/dsh-mcp-client';

/** DSH profile used by default. Overridable via $AGENT_HUB_DSH_PROFILE. */
function profile(): string {
  return process.env.AGENT_HUB_DSH_PROFILE ?? 'web';
}

function patchPath(): string {
  return path.join(clientPaths.dshHome(), 'profiles', profile(), 'cordis.patch.yml');
}

type PatchEntry = { id?: string; name?: string; config?: Record<string, unknown>; insert?: PatchEntry[] };

/** Walk loader patch entries (incl. nested insert lists) and collect dsh-mcp-client configs. */
function collectMcp(entries: PatchEntry[], source: string, out: RawMcp[]): void {
  for (const e of entries) {
    if (e.insert) collectMcp(e.insert, source, out);
    if (e.name === MCP_PLUGIN && e.config) {
      const name = String(e.config.serverName ?? e.id ?? 'unnamed');
      out.push({ name, raw: e.config, source: `${source}#${e.id ?? name}` });
    }
  }
}

async function readRaw(): Promise<RawMcp[]> {
  const src = patchPath();
  const text = await readText(src);
  const out: RawMcp[] = [];
  if (text) {
    const doc = parseYaml(text) as PatchEntry[] | null;
    if (Array.isArray(doc)) collectMcp(doc, src, out);
  }
  return out;
}

export const dshAdapter: ClientAdapter = {
  id: 'dsh',
  label: 'DeepSeek Harness',

  async detect(): Promise<DetectResult> {
    const home = clientPaths.dshHome();
    const paths = {
      home,
      profilePatch: patchPath(),
      skills: clientPaths.agentsSkills(),
      ownSkills: path.join(home, 'skills'),
    };
    return { installed: await exists(home), paths, notes: [`profile: ${profile()}`] };
  },

  readMcpRaw: readRaw,

  async read(): Promise<ClientSnapshot> {
    const mcp = (await readRaw()).map((r) => toMcpEntry(r.name, r.raw, r.source));
    const byName = new Map<string, SkillEntry>();
    for (const s of await listSkills(path.join(clientPaths.dshHome(), 'skills'))) byName.set(s.name, s);
    for (const s of await listSkills(clientPaths.agentsSkills())) byName.set(s.name, s);
    const skills = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
    return { client: 'dsh', skills, mcp };
  },
};
