import { applyImport, planImport, publicImportPlan } from '../core/import-plan.js';
import { c, printJson, table } from '../core/output.js';
import { tildify } from '../core/paths.js';
import { choose, interactive } from '../core/prompt.js';
import { envPath } from '../core/registry.js';

interface Opts {
  dryRun?: boolean;
  prefer?: string;
  overwrite?: boolean;
  json?: boolean;
}

export async function importCommand(item: string | undefined, opts: Opts): Promise<void> {
  const plan = await planImport(item, {
    ...opts,
    chooseClient:
      interactive() && !opts.dryRun
        ? (name, clients, preferred) =>
            choose(`  ${name}: configs differ between clients — take from`, clients, preferred)
        : undefined,
  });
  if (!opts.json) {
    console.log(
      table(
        ['server', 'action', 'found in', 'secrets → .env', 'note'],
        plan.rows.map((r) => [
          r.name,
          r.action === 'add' || r.action === 'update'
            ? c.green(r.action)
            : r.action === 'skip-exists'
              ? c.dim(r.action)
              : c.red(r.action),
          r.from.join(', '),
          r.secrets.length ? c.yellow(r.secrets.join(', ')) : c.dim('—'),
          c.dim(r.note ?? ''),
        ]),
      ),
    );
    console.log(
      `\n${plan.envVars.length} secret(s) → ${tildify(envPath())}: ${plan.envVars.join(', ') || '—'}`,
    );
  }
  if (opts.dryRun) {
    if (opts.json) printJson({ dryRun: true, ...publicImportPlan(plan) });
    if (!opts.json)
      console.log(c.dim('\nDry run — nothing written. Re-run without --dry-run to apply.'));
    return;
  }
  const result = await applyImport(plan);
  if (opts.json) printJson({ dryRun: false, ...publicImportPlan(plan), result });
  if (!opts.json) {
    console.log(
      result.imported
        ? c.green(`\n✓ Imported ${result.imported} server(s) into mcp/servers.yaml`) +
            (result.commit ? c.dim(` (commit ${result.commit})`) : '')
        : c.dim('\nNothing to import.'),
    );
    if (result.imported)
      console.log(
        c.dim(
          'Client configs were not changed. Next: `ahub mcp run <name>` to test, then `ahub sync`.',
        ),
      );
  }
}
