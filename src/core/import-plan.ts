import { ensureBaseline, recordExpectedWrites } from './baseline.js';
import path from 'node:path';
import { snapshot, type FileSnapshot } from './file-store.js';
import { writeTransaction } from './file-transaction.js';
import { withHubLock } from './hub-lock.js';
import { HubError } from './errors.js';
import { createHash } from 'node:crypto';
import { adapters } from '../adapters/index.js';
import { parseEnvText, renderEnvAppend } from './env.js';
import { exists } from './fs.js';
import {
  collectCandidates,
  coreFingerprint,
  extractSecrets,
  findLeftoverSecrets,
  isHubProjection,
  merge,
} from './importer.js';
import {
  definitionSignature,
  desiredSignature,
  parseImportedDefinitions,
  type ImportedDefinitions,
} from './imported-definitions.js';
import { hubRoot, tildify } from './paths.js';
import { parseRegistry, serializeRegistry, validServerName, type HubServer } from './registry.js';
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
  root: string;
  inputs: FileSnapshot[];
  sources: ClientAdapter[];
  sourceRevision: string;
  revision: string;
  rows: ImportRow[];
  next: Record<string, HubServer>;
  newSecrets: Map<string, string>;
  envVars: string[];
  imported: ImportedDefinitions;
}
export async function planImport(
  item: string | undefined,
  opts: ImportOptions = {},
  sources: ClientAdapter[] = adapters,
): Promise<ImportPlan> {
  if (!(await exists(hubRoot())))
    throw new Error(`No hub at ${tildify(hubRoot())}. Run \`ahub init\` first.`);
  if (item && item !== 'mcp' && !item.startsWith('mcp:'))
    throw new Error(
      `Only MCP import is implemented yet (try \`ahub import mcp\` or \`ahub import mcp:<name>\`).`,
    );
  const only = item?.startsWith('mcp:') ? item.slice(4) : undefined;
  const prefer = (opts.prefer ?? 'claude-code,codex').split(',').map((s) => s.trim()) as ClientId[];

  const root = path.resolve(hubRoot());
  const inputs = await Promise.all(
    ['mcp/servers.yaml', '.env', 'state/imported-definitions.json'].map((file) =>
      snapshot(path.join(root, file)),
    ),
  );
  const raws = await readSources(sources);
  const sourceRevision = digest(raws);
  const byName = collectCandidates(raws);
  const reg =
    inputs[0].content === null
      ? { version: 1 as const, servers: {} as Record<string, HubServer> }
      : parseRegistry(inputs[0].content);
  const envTaken = parseEnvText(inputs[1].content ?? '');
  const imported = parseImportedDefinitions(inputs[2].content);
  const importedBefore = structuredClone(imported);

  const rows: ImportRow[] = [];
  const newSecrets = new Map<string, string>();
  const next: Record<string, HubServer> = { ...reg.servers };

  for (const [name, cands] of [...byName].sort(([a], [b]) => a.localeCompare(b))) {
    if (only && name !== only) continue;
    if (!validServerName(name))
      throw new HubError('Invalid MCP server name in a client configuration.');

    if (reg.servers[name] && !opts.overwrite) {
      rows.push({
        name,
        action: 'skip-exists',
        from: [],
        secrets: [],
        note: 'already in hub (use --overwrite)',
      });
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
        rows.push({
          name,
          action: 'conflict',
          from: [],
          secrets: [],
          note: 'configs differ; pass --prefer',
        });
        continue;
      }
    }

    const ex = extractSecrets(name, res.server!, new Map([...envTaken, ...newSecrets]));
    const leftovers = findLeftoverSecrets(ex.server);
    if (leftovers.length) {
      rows.push({
        name,
        action: 'error',
        from: res.from,
        secrets: [],
        note: `possible secret left in ${leftovers.join(', ')} — not imported`,
      });
      continue;
    }
    for (const [k, v] of ex.secrets) newSecrets.set(k, v);
    next[name] = ex.server;
    Object.defineProperty(imported.servers, name, {
      value: {
        desired: desiredSignature(ex.server, new Map([...envTaken, ...newSecrets])),
        clients: Object.fromEntries(
          raws.flatMap(({ client, items }) =>
            items
              .filter((r) => r.name === name && !isHubProjection(r.raw))
              .map((r) => [client, definitionSignature(r.raw)]),
          ),
        ),
      },
      enumerable: true,
      configurable: true,
      writable: true,
    });

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

  const revision = createHash('sha256')
    .update(
      JSON.stringify({
        raws,
        reg,
        env: [...envTaken],
        importedBefore,
        item,
        prefer,
        overwrite: !!opts.overwrite,
      }),
    )
    .digest('hex');
  const envVars = [...newSecrets.keys()].filter((k) => !envTaken.has(k));

  return {
    root,
    inputs,
    sources,
    sourceRevision,
    revision,
    rows,
    next,
    newSecrets,
    envVars,
    imported,
  };
}
export function publicImportPlan(plan: ImportPlan) {
  return { revision: plan.revision, servers: plan.rows, envVarsToAdd: plan.envVars };
}
async function readSources(sources: ClientAdapter[]) {
  return Promise.all(
    sources.map(async (adapter) => ({
      client: adapter.id,
      items: (await adapter.detect()).installed ? await adapter.readMcpRaw() : [],
    })),
  );
}
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export async function applyImport(plan: ImportPlan) {
  const changed = plan.rows.filter((row) => row.action === 'add' || row.action === 'update');
  if (!changed.length) return { imported: 0, commit: undefined };
  return withHubLock(plan.root, async (origin) => {
    if (digest(await readSources(plan.sources)) !== plan.sourceRevision)
      throw new HubError('Client definitions changed since import planning. Review a new plan.');
    const detected = await Promise.all(
      plan.sources.map(async (source) => ({ source, result: await source.detect() })),
    );
    await ensureBaseline(
      plan.root,
      detected.flatMap(({ source, result }) => {
        const file = result.paths.config ?? result.paths.profilePatch;
        return typeof file === 'string'
          ? [{ file, client: source.id, installed: result.installed }]
          : [];
      }),
      origin,
    );
    const [registry, environment, provenance] = plan.inputs;
    const env = renderEnvAppend(
      environment.content ?? '',
      plan.newSecrets,
      'Imported by Agent Hub',
    );
    const changes = [
      { before: { ...environment, mode: 0o600 }, after: env.content },
      { before: registry, after: serializeRegistry({ version: 1, servers: plan.next }) },
      {
        before: { ...provenance, mode: 0o600 },
        after: JSON.stringify(plan.imported, null, 2) + '\n',
      },
    ];
    await recordExpectedWrites(plan.root, changes);
    await writeTransaction(changes);
    // Committing is an explicit user action; an import must not stage unrelated hub changes.
    return { imported: changed.length, commit: undefined };
  });
}
