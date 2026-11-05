import path from 'node:path';
import { discoverNativeHistory } from './history/discovery.js';
import type {
  ClientAdapter,
  ClientSnapshot,
  DetectResult,
  RawMcp,
  SkillEntry,
} from '../contracts/clients.js';
import { dshProfile, readSettings } from '../core/configuration/settings.js';
import { readDefinitions } from '../core/mcp/config-edit.js';
import { toMcpEntry } from '../core/mcp/mcp.js';
import { exists, listSkills, readText } from '../shared/fs.js';
import { clientPaths, hubRoot } from '../shared/paths.js';

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
  discoverSessions: (control) => discoverNativeHistory('dsh', control),
  id: 'dsh',
  label: 'DeepSeek Harness',

  async detect(): Promise<DetectResult> {
    const home = clientPaths.dshHome();
    const paths = {
      home,
      profilePatch: await patchPath(),
      skills: clientPaths.dshSkills(),
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
    for (const s of await listSkills(clientPaths.dshSkills())) byName.set(s.name, s);
    for (const s of await listSkills(path.join(clientPaths.dshHome(), 'skills')))
      byName.set(s.name, s);
    const skills = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
    return { client: 'dsh', skills, mcp };
  },
};
