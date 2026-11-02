import { createHash } from 'node:crypto';
import { adapters } from '../adapters/index.js';
import { appendEnv, readEnvFile } from './env.js';
import { exists } from './fs.js';
import { commitAll, isOwnRepo } from './git.js';
import { collectCandidates, coreFingerprint, extractSecrets, findLeftoverSecrets, isHubProjection, merge } from './importer.js';
import { definitionSignature, desiredSignature, readImportedDefinitions, writeImportedDefinitions, type ImportedDefinitions } from './imported-definitions.js';
import { hubRoot, tildify } from './paths.js';
import { envPath, readRegistry, writeRegistry, type HubServer } from './registry.js';
import type { ClientAdapter, ClientId } from './types.js';

export interface ImportOptions {
  prefer?: string;
  overwrite?: boolean;
  chooseClient?: (name: string, clients: ClientId[], preferred: ClientId) => Promise<ClientId>;
}
export type ImportRow = {
  name: string;
  action: 'add' | 'update' | 'skip-exists' | 'conflict' | 'error';
  from: ClientId[];
  secrets: string[];
  note?: string;
};

/** Internal plan contains credentials. Never serialize it; use publicImportPlan. */
export interface ImportPlan {
  revision: string;
  rows: ImportRow[];
  next: Record<string, HubServer>;
  newSecrets: Map<string, string>;
  envVars: string[];
  imported: ImportedDefinitions;
}
export async function planImport(item: string | undefined, opts: ImportOptions = {}, sources: ClientAdapter[] = adapters): Promise<ImportPlan> {
  if (!(await exists(hubRoot()))) throw new Error(`No hub at ${tildify(hubRoot())}. Run \`ahub init\` first.`);
  if (item && item != 'mcp' && !item.startsWith('mcp:')) throw new Error(`Only MCP import is implemented yet (try \`ahub import mcp\` or \`ahub import mcp:<name>\`).`);
  const only = item?.startsWith('mcp:') ? item.slice(4) : undefined;
  const prefer = (opts.prefer ?? 'claude-code,codex').split(',').map((s) => s.trim()) as ClientId[];

  const raws = await Promise.all(
    sources.map(async (a) => ({ client: a.id, items: (await a.detect()).installed ? await a.readMcpRaw() : [] })),
  );
  const byName = collectCandidates(raws);
  const reg = await readRegistry();
  const envTaken = await readEnvFile(envPath());
  const imported = await readImportedDefinitions(hubRoot());
  const importedBefore = structuredClone(imported);

  const rows: ImportRow[] = [];
  const newSecrets = new Map<string, string>();
  const next: Record<string, HubServer> = { ...reg.servers };

  for (const [name, cands] of [...byName].sort(([a], [b]) => a.localeCompare(b))) {
    if (only && name !== only) continue;

    if (reg.servers[name] && !opts.overwrite) {
      rows.push({ name, action: 'skip-exists', from: [], secrets: [], note: 'already in hub (use --overwrite)' });
      continue;
    }

    let res = merge(name, cands, []);
    if (res.conflict && !res.server) {
      // ask, or fall back to --prefer order
      let pick = prefer.find((p) => cands.some((c) => c.client === p));
      if (opts.chooseClient) {
        const clientsWithVariant = [...new Set(cands.map((c) => c.client))];
        pick = await opts.chooseClient(name, clientsWithVariant, pick ?? clientsWithVariant[0]);
      }
      res = merge(name, cands, pick ? [pick] : prefer);
      if (!res.server) {
        rows.push({ name, action: 'conflict', from: [], secrets: [], note: 'configs differ; pass --prefer' });
        continue;
      }
    }

    const ex = extractSecrets(name, res.server!, new Map([...envTaken, ...newSecrets]));
    const leftovers = findLeftoverSecrets(ex.server);
    if (leftovers.length) {
      rows.push({ name, action: 'error', from: res.from, secrets: [], note: `possible secret left in ${leftovers.join(', ')} — not imported` });
      continue;
    }
    for (const [k, v] of ex.secrets) newSecrets.set(k, v);
    next[name] = ex.server;
    Object.defineProperty(imported.servers, name, { value: {
      desired: desiredSignature(ex.server, new Map([...envTaken, ...newSecrets])),
      clients: Object.fromEntries(raws.flatMap(({ client, items }) => items.filter((r) => r.name === name && !isHubProjection(r.raw)).map((r) => [client, definitionSignature(r.raw)]))),
    }, enumerable: true, configurable: true, writable: true });

    const variants = new Set(cands.map((c) => coreFingerprint(c.server))).size;
    const notes = [
      variants > 1 ? `differs across clients — took ${res.from.join('+')}` : '',
      ex.server.only ? `only: ${ex.server.only.join(',')}` : '',
    ].filter(Boolean);
    rows.push({
      name,
      action: reg.servers[name] ? 'update' : 'add',
      from: [...new Set(cands.map((c) => c.client))],
      secrets: ex.replaced,
      note: notes.join('; ') || undefined,
    });
  }

  const revision = createHash('sha256').update(JSON.stringify({ raws, reg, env: [...envTaken], importedBefore, item, prefer, overwrite: !!opts.overwrite })).digest('hex');
  const envVars = [...newSecrets.keys()].filter((k) => !envTaken.has(k));

  return { revision, rows, next, newSecrets, envVars, imported };
}
export function publicImportPlan(plan: ImportPlan) {
  return { revision: plan.revision, servers: plan.rows, envVarsToAdd: plan.envVars };
}
export async function applyImport(plan: ImportPlan) {
  const { rows, envVars, newSecrets, next } = plan;
  const changed = rows.filter((r) => r.action === 'add' || r.action === 'update');
  if (!changed.length) return { imported: 0, commit: undefined };
  await appendEnv(envPath(), new Map(envVars.map((k) => [k, newSecrets.get(k)!])), `imported by ahub ${new Date().toISOString()}`);
  await writeRegistry({ version: 1, servers: next });
  await writeImportedDefinitions(hubRoot(), plan.imported);
  const commit = isOwnRepo() ? commitAll(`mcp: import ${changed.map((r) => r.name).join(', ')}`) : undefined;
  return { imported: changed.length, commit };
}
