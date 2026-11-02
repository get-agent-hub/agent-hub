import { readDefinitions } from '../core/config-edit.js';
import { readSettings, dshProfile } from '../core/settings.js';
import { hubRoot } from '../core/paths.js';
import path from 'node:path';
import { clientPaths } from '../core/paths.js';
import { exists, listSkills, readText } from '../core/fs.js';
import { toMcpEntry } from '../core/mcp.js';
import type {
  ClientAdapter,
  ClientSnapshot,
  DetectResult,
  RawMcp,
  SkillEntry,
} from '../core/types.js';

async function patchPath(): Promise<string> {
  return path.join(
    clientPaths.dshHome(),
    'profiles',
    dshProfile(await readSettings(hubRoot(), true)),
    'cordis.patch.yml',
  );
}

async function readRaw(): Promise<RawMcp[]> {
  const file = await patchPath();
  return [...readDefinitions('dsh', (await readText(file)) ?? null)].map(([name, raw]) => ({
    name,
    raw,
    source: file,
  }));
}

export const dshAdapter: ClientAdapter = {
  id: 'dsh',
  label: 'DeepSeek Harness',

  async detect(): Promise<DetectResult> {
    const home = clientPaths.dshHome();
    const paths = {
      home,
      profilePatch: await patchPath(),
      skills: clientPaths.agentsSkills(),
      ownSkills: path.join(home, 'skills'),
    };
    return {
      installed: await exists(home),
      paths,
      notes: [`profile: ${dshProfile(await readSettings(hubRoot(), true))}`],
    };
  },

  readMcpRaw: readRaw,

  async read(): Promise<ClientSnapshot> {
    const mcp = (await readRaw()).map((r) => toMcpEntry(r.name, r.raw, r.source));
    const byName = new Map<string, SkillEntry>();
    for (const s of await listSkills(path.join(clientPaths.dshHome(), 'skills')))
      byName.set(s.name, s);
    for (const s of await listSkills(clientPaths.agentsSkills())) byName.set(s.name, s);
    const skills = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
    return { client: 'dsh', skills, mcp };
  },
};
