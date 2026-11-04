import { applyImport, planImport, publicImportPlan } from '../core/import-plan.js';
import { c, printJson, table } from '../core/output.js';
import { tildify } from '../core/paths.js';
import { envPath } from '../core/registry.js';
import { runManaged } from './content.js';
import { planSkillImport } from '../core/skills.js';
import { confirmReviewed, reviewMode } from './review.js';
import type { ClientId } from '../core/types.js';
import { HubError } from '../core/errors.js';

interface Opts {
  source?: ClientId;
  interactive?: boolean;
  apply?: boolean;
  expect?: string;
  dryRun?: boolean;
  prefer?: string;
  overwrite?: boolean;
  json?: boolean;
}

export async function importCommand(item: string | undefined, opts: Opts): Promise<void> {
  reviewMode(opts);
  if (/^skills?(?::|$)/.test(item ?? ''))
    return runManaged(() => planSkillImport(item, opts), opts);
  if (opts.apply && opts.dryRun) throw new HubError('Choose --apply or --dry-run, not both.');
  if (opts.apply && !opts.expect)
    throw new HubError('Preview import first, then use --apply --expect from that plan.');
  const plan = await planImport(item, opts);
  if (opts.expect && opts.expect !== plan.revision)
    throw new HubError('Import inputs changed since preview. Review a new plan.');
  const preview = publicImportPlan(plan);
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
  if (!opts.apply) {
    if (opts.json) printJson({ dryRun: true, ...preview });
    if (!opts.json)
      console.log(
        plan.blocked
          ? '\nBlocked by conflicts. Select an explicit --prefer source and preview again.'
          : `\nPreview only — nothing written. Apply this exact plan:\n${preview.commands.apply}`,
      );
    if (plan.blocked) process.exitCode = 1;
    if (!(await confirmReviewed(opts, plan.blocked))) return;
  }
  const result = await applyImport(plan, opts.expect ?? plan.revision);
  if (opts.json) printJson({ dryRun: false, ...preview, result });
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
