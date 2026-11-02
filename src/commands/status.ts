import { adapters } from '../adapters/index.js';
import { readHub } from '../core/hub.js';
import { c, printJson, table } from '../core/output.js';
import { tildify } from '../core/paths.js';
import type { ClientId, ClientSnapshot, HubState, McpEntry, SkillEntry } from '../core/types.js';

type Col = 'hub' | ClientId;

export interface StatusReport {
  hub: { root: string; exists: boolean };
  clients: { id: ClientId; label: string; installed: boolean; paths: Record<string, string> }[];
  skills: { name: string; cells: Record<Col, SkillCell> }[];
  mcp: { name: string; cells: Record<Col, McpCell>; variants: number; inlineSecret: boolean }[];
  drift: { kind: 'only-in-client' | 'only-in-hub' | 'differs' | 'broken'; area: 'skill' | 'mcp'; name: string; client?: ClientId }[];
}

type SkillCell = 'ok' | 'missing' | 'broken' | 'other-copy';
/** For MCP: variant letter (A, B, …) per distinct config, or null if absent. */
type McpCell = string | null;

export async function collectStatus(): Promise<StatusReport> {
  const hub = await readHub();
  const detected = await Promise.all(adapters.map(async (a) => ({ a, d: await a.detect() })));
  const installed = detected.filter((x) => x.d.installed);
  const snaps: ClientSnapshot[] = await Promise.all(installed.map((x) => x.a.read()));
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
      else if (col !== 'hub' && hubSkill && hubSkill.realPath && s.realPath !== hubSkill.realPath) cells[col] = 'other-copy';
      else cells[col] = 'ok';

      if (col === 'hub') continue;
      const client = col as ClientId;
      if (cells[col] === 'broken') drift.push({ kind: 'broken', area: 'skill', name, client });
      else if (cells[col] === 'other-copy') drift.push({ kind: 'differs', area: 'skill', name, client });
      else if (cells[col] === 'ok' && !hubSkill && hub.exists) drift.push({ kind: 'only-in-client', area: 'skill', name, client });
      else if (cells[col] === 'missing' && hubSkill) drift.push({ kind: 'only-in-hub', area: 'skill', name, client });
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
      if (!letters.has(m.fingerprint)) letters.set(m.fingerprint, String.fromCharCode(65 + letters.size));
      cells[col] = letters.get(m.fingerprint)!;
    }
    const hubCell = cells.hub;
    for (const col of cols) {
      if (col === 'hub') continue;
      const client = col as ClientId;
      if (cells[col] && !hubCell && hub.exists) drift.push({ kind: 'only-in-client', area: 'mcp', name, client });
      else if (!cells[col] && hubCell) drift.push({ kind: 'only-in-hub', area: 'mcp', name, client });
      else if (cells[col] && hubCell && cells[col] !== hubCell) drift.push({ kind: 'differs', area: 'mcp', name, client });
    }
    return { name, cells, variants: letters.size, inlineSecret };
  });

  return {
    hub: { root: hub.root, exists: hub.exists },
    clients: detected.map(({ a, d }) => ({ id: a.id, label: a.label, installed: d.installed, paths: d.paths })),
    skills,
    mcp,
    drift,
  };
}

const skillMark: Record<SkillCell, string> = {
  ok: c.green('✓'),
  missing: c.dim('·'),
  broken: c.red('✗'),
  'other-copy': c.yellow('≠'),
};

export async function statusCommand(opts: { json?: boolean }): Promise<void> {
  const r = await collectStatus();
  if (opts.json) return printJson(r);

  const cols: Col[] = ['hub', ...r.clients.filter((x) => x.installed).map((x) => x.id)];
  const head = (first: string) => [first, ...cols];

  console.log(c.bold('Hub   ') + (r.hub.exists ? tildify(r.hub.root) : c.yellow(`${tildify(r.hub.root)} (not initialized — run \`ahub init\`)`)));
  for (const cl of r.clients) {
    console.log(`${c.bold(cl.label.padEnd(18))}${cl.installed ? c.green('found') : c.dim('not found')}`);
  }

  console.log('\n' + c.cyan(`Skills (${r.skills.length})`));
  console.log(table(head('name'), r.skills.map((s) => [s.name, ...cols.map((col) => skillMark[s.cells[col]])])));

  console.log('\n' + c.cyan(`MCP servers (${r.mcp.length})`) + c.dim('  letters = distinct configs; same letter = identical'));
  console.log(
    table(
      [...head('name'), ''],
      r.mcp.map((m) => [
        m.name,
        ...cols.map((col) => {
          const v = m.cells[col];
          if (!v) return c.dim('·');
          return m.variants > 1 ? c.yellow(v) : c.green(v);
        }),
        m.inlineSecret ? c.yellow('inline secret') : '',
      ]),
    ),
  );

  const counts = r.drift.reduce<Record<string, number>>((acc, d) => ((acc[d.kind] = (acc[d.kind] ?? 0) + 1), acc), {});
  console.log(
    '\n' +
      (r.drift.length === 0
        ? c.green('No drift.')
        : c.yellow(`Drift: ${Object.entries(counts).map(([k, n]) => `${n} ${k}`).join(', ')}`) + c.dim('  (details: --json)')),
  );
}
