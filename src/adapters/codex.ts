import path from 'node:path';
import { discoverNativeHistory } from './history/discovery.js';
import type {
  ClientAdapter,
  ClientSnapshot,
  DetectResult,
  RawMcp,
  SkillEntry,
} from '../contracts/clients.js';
import { readDefinitions } from '../core/mcp/config-edit.js';
import { toMcpEntry } from '../core/mcp/mcp.js';
import { exists, listSkills, readText } from '../shared/fs.js';
import { clientPaths } from '../shared/paths.js';

export const codexAdapter: ClientAdapter = {
  discoverSessions: (control) => discoverNativeHistory('codex', control),
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
    return [...readDefinitions('codex', (await readText(cfgPath)) ?? null)].map(([name, raw]) => ({
      name,
      raw,
      source: cfgPath,
    }));
  },

  async read(): Promise<ClientSnapshot> {
    const mcp = (await this.readMcpRaw()).map((r) => toMcpEntry(r.name, r.raw, r.source));

    // Codex reads ~/.agents/skills (shared) and ~/.codex/skills (own). Merge, shared wins.
    const byName = new Map<string, SkillEntry>();
    for (const s of await listSkills(path.join(clientPaths.codexHome(), 'skills')))
      byName.set(s.name, s);
    for (const s of await listSkills(clientPaths.agentsSkills())) byName.set(s.name, s);
    const skills = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));

    return { client: 'codex', skills, mcp };
  },
};
