import path from 'node:path';
import { parse as parseToml } from 'smol-toml';
import { clientPaths } from '../core/paths.js';
import { exists, listSkills, readText } from '../core/fs.js';
import { toMcpEntry } from '../core/mcp.js';
import type { ClientAdapter, ClientSnapshot, DetectResult, RawMcp, SkillEntry } from '../core/types.js';

export const codexAdapter: ClientAdapter = {
  id: 'codex',
  label: 'Codex CLI',

  async detect(): Promise<DetectResult> {
    const home = clientPaths.codexHome();
    const paths = {
      home,
      config: path.join(home, 'config.toml'),
      skills: clientPaths.agentsSkills(),
      legacySkills: path.join(home, 'skills'),
    };
    return { installed: await exists(home), paths };
  },

  async readMcpRaw(): Promise<RawMcp[]> {
    const cfgPath = path.join(clientPaths.codexHome(), 'config.toml');
    const text = await readText(cfgPath);
    const cfg = text ? (parseToml(text) as { mcp_servers?: Record<string, Record<string, unknown>> }) : {};
    return Object.entries(cfg.mcp_servers ?? {}).map(([name, raw]) => ({ name, raw, source: `${cfgPath}#mcp_servers` }));
  },

  async read(): Promise<ClientSnapshot> {
    const mcp = (await this.readMcpRaw()).map((r) => toMcpEntry(r.name, r.raw, r.source));

    // Codex reads ~/.agents/skills (shared) and ~/.codex/skills (own). Merge, shared wins.
    const byName = new Map<string, SkillEntry>();
    for (const s of await listSkills(path.join(clientPaths.codexHome(), 'skills'))) byName.set(s.name, s);
    for (const s of await listSkills(clientPaths.agentsSkills())) byName.set(s.name, s);
    const skills = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));

    return { client: 'codex', skills, mcp };
  },
};
