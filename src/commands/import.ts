import { adapters } from '../adapters/index.js';
import { appendEnv, readEnvFile } from '../core/env.js';
import { exists } from '../core/fs.js';
import { commitAll, isOwnRepo } from '../core/git.js';
import { collectCandidates, coreFingerprint, extractSecrets, findLeftoverSecrets, merge } from '../core/importer.js';
import { c, printJson, table } from '../core/output.js';
import { hubRoot, tildify } from '../core/paths.js';
import { choose, interactive } from '../core/prompt.js';
import { envPath, readRegistry, writeRegistry, type HubServer } from '../core/registry.js';
import type { ClientId } from '../core/types.js';

interface Opts {
  dryRun?: boolean;
  prefer?: string;
  overwrite?: boolean;
  json?: boolean;
}

type Row = {
  name: string;
  action: 'add' | 'update' | 'skip-exists' | 'conflict' | 'error';
  from: ClientId[];
  secrets: string[];
  note?: string;
};

export async function importCommand(item: string | undefined, opts: Opts): Promise<void> {
  if (!(await exists(hubRoot()))) throw new Error(`No hub at ${tildify(hubRoot())}. Run \`ahub init\` first.`);
  if (item && !item.startsWith('mcp')) throw new Error(`Only MCP import is implemented yet (try \`ahub import mcp\` or \`ahub import mcp:<name>\`).`);
  const only = item?.startsWith('mcp:') ? item.slice(4) : undefined;
  const prefer = (opts.prefer ?? 'claude-code,codex').split(',').map((s) => s.trim()) as ClientId[];

  const raws = await Promise.all(
    adapters.map(async (a) => ({ client: a.id, items: (await a.detect()).installed ? await a.readMcpRaw() : [] })),
  );
  const byName = collectCandidates(raws);
  const reg = await readRegistry();
  const envTaken = await readEnvFile(envPath());

  const rows: Row[] = [];
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
      if (interactive() && !opts.dryRun) {
        const clientsWithVariant = [...new Set(cands.map((c) => c.client))];
        pick = await choose(`  ${name}: configs differ between clients — take from`, clientsWithVariant, pick ?? clientsWithVariant[0]);
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

  const envVars = [...newSecrets.keys()].filter((k) => !envTaken.has(k));

  if (opts.json) {
    printJson({ dryRun: !!opts.dryRun, servers: rows, envVarsToAdd: envVars });
  } else {
    console.log(
      table(
        ['server', 'action', 'found in', 'secrets → .env', 'note'],
        rows.map((r) => [
          r.name,
          r.action === 'add' || r.action === 'update' ? c.green(r.action) : r.action === 'skip-exists' ? c.dim(r.action) : c.red(r.action),
          r.from.join(', '),
          r.secrets.length ? c.yellow(r.secrets.join(', ')) : c.dim('—'),
          c.dim(r.note ?? ''),
        ]),
      ),
    );
    console.log(`\n${envVars.length} secret(s) → ${tildify(envPath())}: ${envVars.length ? envVars.join(', ') : '—'}`);
  }

  if (opts.dryRun) {
    if (!opts.json) console.log(c.dim('\nDry run — nothing written. Re-run without --dry-run to apply.'));
    return;
  }

  const changed = rows.filter((r) => r.action === 'add' || r.action === 'update');
  if (!changed.length) {
    if (!opts.json) console.log(c.dim('\nNothing to import.'));
    return;
  }
  // .env first: if it fails, the registry must not reference vars that don't exist.
  await appendEnv(envPath(), new Map(envVars.map((k) => [k, newSecrets.get(k)!])), `imported by ahub ${new Date().toISOString()}`);
  await writeRegistry({ version: 1, servers: next });
  const sha = isOwnRepo() ? commitAll(`mcp: import ${changed.map((r) => r.name).join(', ')}`) : undefined;
  if (!opts.json) {
    console.log(c.green(`\n✓ Imported ${changed.length} server(s) into mcp/servers.yaml`) + (sha ? c.dim(` (commit ${sha})`) : ''));
    console.log(c.dim('Client configs were not changed. Next: `ahub mcp run <name>` to test, then `ahub sync`.'));
  }
}
