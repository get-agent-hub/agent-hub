import { adapters } from '../../adapters/index.js';
import { appManaged, reservedSkill } from '../../adapters/policies.js';
import type {
  ClientAdapter,
  ClientId,
  ClientSnapshot,
  McpEntry,
  SkillEntry,
} from '../../contracts/clients.js';
import { hash } from '../../shared/values.js';
import { readEnvFile } from '../configuration/env.js';
import { readHub } from '../configuration/hub.js';
import { envPath, readRegistry } from '../configuration/registry.js';
import { normalize } from '../mcp/importer.js';
import { isCurrentProjection, semantic } from '../mcp/sync.js';

export type Col = 'hub' | ClientId;

export interface StatusReport {
  hub: { root: string; exists: boolean };
  clients: { id: ClientId; label: string; installed: boolean; paths: Record<string, string> }[];
  skills: { name: string; cells: Record<Col, SkillCell> }[];
  mcp: { name: string; cells: Record<Col, McpCell>; variants: number; inlineSecret: boolean }[];
  drift: {
    kind: 'only-in-client' | 'only-in-hub' | 'differs' | 'broken';
    area: 'skill' | 'mcp';
    name: string;
    client?: ClientId;
  }[];
}

export type SkillCell = 'ok' | 'missing' | 'broken' | 'other-copy';
/** For MCP: variant letter per effective launch definition, or null if absent. */
type McpCell = string | null;

export async function collectStatus(sources: ClientAdapter[] = adapters): Promise<StatusReport> {
  const hub = await readHub();
  const detected = await Promise.all(sources.map(async (a) => ({ a, d: await a.detect() })));
  const installed = detected.filter((x) => x.d.installed);
  const snaps: ClientSnapshot[] = await Promise.all(installed.map((x) => x.a.read()));
  const [registry, hubEnv, rawClients] = await Promise.all([
    readRegistry(),
    readEnvFile(envPath()),
    Promise.all(installed.map(async ({ a }) => ({ client: a.id, items: await a.readMcpRaw() }))),
  ]);
  const hubFingerprints = new Map(
    Object.entries(registry.servers).map(([name, s]) => [
      name,
      hash(semantic(s, hubEnv)).slice(0, 12),
    ]),
  );
  for (const m of hub.mcp) m.fingerprint = hubFingerprints.get(m.name) ?? m.fingerprint;
  for (const { client, items } of rawClients) {
    const snap = snaps.find((s) => s.client === client)!;
    for (const raw of items) {
      const entry = snap.mcp.find((m) => m.name === raw.name);
      if (entry)
        entry.fingerprint =
          isCurrentProjection(raw.raw, raw.name, hub.root) && hubFingerprints.has(raw.name)
            ? hubFingerprints.get(raw.name)!
            : hash(semantic(normalize(client, raw.raw), hubEnv)).slice(0, 12);
    }
  }
  const cols: Col[] = ['hub', ...snaps.map((s) => s.client)];

  const drift: StatusReport['drift'] = [];

  // ---- skills
  const skillMaps = new Map<Col, Map<string, SkillEntry>>();
  skillMaps.set('hub', new Map(hub.skills.map((s) => [s.name, s])));
  for (const s of snaps) skillMaps.set(s.client, new Map(s.skills.map((k) => [k.name, k])));
  const skillNames = [...new Set([...skillMaps.values()].flatMap((m) => [...m.keys()]))].sort();

  const skills = skillNames.map((name) => {
    const hubSkill = skillMaps.get('hub')!.get(name);
    const cells = {} as Record<Col, SkillCell>;
    for (const col of cols) {
      const s = skillMaps.get(col)!.get(name);
      if (!s) cells[col] = 'missing';
      else if (!s.realPath || !s.hasSkillMd) cells[col] = 'broken';
      else if (col !== 'hub' && hubSkill && hubSkill.realPath && s.realPath !== hubSkill.realPath)
        cells[col] = 'other-copy';
      else cells[col] = 'ok';

      if (col === 'hub') continue;
      const client = col as ClientId;
      if (cells[col] === 'broken') drift.push({ kind: 'broken', area: 'skill', name, client });
      else if (cells[col] === 'other-copy')
        drift.push({ kind: 'differs', area: 'skill', name, client });
      else if (cells[col] === 'ok' && !hubSkill && hub.exists)
        drift.push({ kind: 'only-in-client', area: 'skill', name, client });
      else if (cells[col] === 'missing' && hubSkill && !reservedSkill(client, name))
        drift.push({ kind: 'only-in-hub', area: 'skill', name, client });
    }
    return { name, cells };
  });

  // ---- mcp
  const mcpMaps = new Map<Col, Map<string, McpEntry>>();
  mcpMaps.set('hub', new Map(hub.mcp.map((m) => [m.name, m])));
  for (const s of snaps) mcpMaps.set(s.client, new Map(s.mcp.map((m) => [m.name, m])));
  const mcpNames = [...new Set([...mcpMaps.values()].flatMap((m) => [...m.keys()]))].sort();

  const mcp = mcpNames.map((name) => {
    const letters = new Map<string, string>();
    const cells = {} as Record<Col, McpCell>;
    let inlineSecret = false;
    for (const col of cols) {
      const m = mcpMaps.get(col)!.get(name);
      if (!m) {
        cells[col] = null;
        continue;
      }
      inlineSecret ||= m.hasInlineSecret;
      if (!letters.has(m.fingerprint))
        letters.set(m.fingerprint, String.fromCharCode(65 + letters.size));
      cells[col] = letters.get(m.fingerprint)!;
    }
    const hubCell = cells.hub;
    for (const col of cols) {
      if (col === 'hub') continue;
      const client = col as ClientId;
      if (cells[col] && !hubCell && hub.exists)
        drift.push({ kind: 'only-in-client', area: 'mcp', name, client });
      else if (
        !cells[col] &&
        hubCell &&
        (!registry.servers[name]?.only || registry.servers[name].only!.includes(client)) &&
        !appManaged(registry.servers[name] ?? {})
      )
        drift.push({ kind: 'only-in-hub', area: 'mcp', name, client });
      else if (cells[col] && hubCell && cells[col] !== hubCell)
        drift.push({ kind: 'differs', area: 'mcp', name, client });
    }
    return { name, cells, variants: letters.size, inlineSecret };
  });

  return {
    hub: { root: hub.root, exists: hub.exists },
    clients: detected.map(({ a, d }) => ({
      id: a.id,
      label: a.label,
      installed: d.installed,
      paths: d.paths,
    })),
    skills,
    mcp,
    drift,
  };
}
