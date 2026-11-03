import { HubError } from '../core/errors.js';
import { applySync, planSync, publicSyncPlan } from '../core/sync.js';
import { applyRestore, planRestore, publicRestorePlan } from '../core/restore.js';
import { printJson, table } from '../core/output.js';
import type { ClientId } from '../core/types.js';
import { runManaged } from './content.js';
import { planSkillSync } from '../core/skills.js';
import { hubRoot } from '../core/paths.js';
import { planManagedRestore } from '../core/managed-plan.js';
import { planContextSync } from '../core/context-sync.js';

interface Options {
  area?: string;
  apply?: boolean;
  dryRun?: boolean;
  client?: string;
  expect?: string;
  replace?: string[];
  only?: string[];
  json?: boolean;
}

export async function syncCommand(opts: Options) {
  if (opts.area && opts.area !== 'mcp') {
    if (opts.area === 'context') {
      if (opts.replace || opts.only)
        throw new HubError(
          '--replace and --only are not supported for instruction blocks. Resolve edited blocks explicitly.',
        );
      return runManaged(
        () => planContextSync({ client: opts.client as ClientId | undefined }),
        opts,
      );
    }
    if (opts.area !== 'skills')
      throw new HubError('Unknown sync area. Choose mcp, skills or context.');
    return runManaged(
      () =>
        planSkillSync({
          client: opts.client as ClientId | undefined,
          replace: opts.replace,
          only: opts.only,
        }),
      opts,
    );
  }
  if (opts.apply && opts.dryRun) throw new HubError('Choose --dry-run or --apply, not both.');
  if (opts.apply && !opts.expect)
    throw new HubError('Preview sync first, then apply with its exact --expect revision.');
  const plan = await planSync({
    client: opts.client as ClientId | undefined,
    replace: opts.replace,
    only: opts.only,
  });
  if (opts.expect && opts.expect !== plan.revision)
    throw new HubError('Configuration changed since that dry run. Review a new plan.');
  const preview = publicSyncPlan(plan);
  if (opts.apply) {
    const result = await applySync(plan, opts.expect);
    if (opts.json) printJson({ ...preview, dryRun: false, result });
    else {
      console.log(
        `Synced ${result.changedFiles} client file(s).${result.backup ? ` Backup: ${result.backup}` : ''}`,
      );
      if (result.restoreCommand) console.log(`\nPreview rollback:\n${result.restoreCommand}`);
      console.log('Restart the affected clients to load their new MCP configuration.');
    }
    return;
  }
  if (opts.json) printJson({ ...preview, dryRun: true });
  else {
    console.log('MCP sync — dry run. No files written.');
    for (const file of preview.files) {
      console.log(`\n${file.label} → ${file.path}${file.changed ? '' : ' (unchanged)'}`);
      if (file.problem) console.log(`  BLOCKED: ${file.problem}`);
      console.log(
        table(
          ['server', 'action', 'note'],
          file.rows.map((r) => [r.name, r.action, r.note ?? '']),
        ),
      );
      for (const row of file.rows)
        if (['add', 'replace'].includes(row.action) && row.command)
          console.log(`  ${row.name}: ${row.command}`);
    }
    console.log(
      `\n${preview.files.filter((f) => f.changed).length} client file(s) would change. Backups are created only on apply.`,
    );
    console.log(
      plan.blocked
        ? '\nBlocked by conflicts. Review the entries above or select an unaffected --client.'
        : `\nApply this exact plan:\n${preview.commands.apply}`,
    );
  }
  if (plan.blocked) process.exitCode = 1;
}

export async function restoreCommand(id: string, opts: Options) {
  if (id.startsWith('content-')) return runManaged(() => planManagedRestore(id, hubRoot()), opts);
  if (opts.apply && opts.dryRun) throw new HubError('Choose --dry-run or --apply, not both.');
  if (opts.apply && !opts.expect)
    throw new HubError('Preview restore first, then apply with its exact --expect revision.');
  const plan = await planRestore(id);
  if (opts.expect && opts.expect !== plan.revision)
    throw new HubError('Configuration changed since that restore preview.');
  const preview = publicRestorePlan(plan);
  if (opts.apply) {
    const result = await applyRestore(plan);
    if (opts.json) printJson(result);
    else console.log(`Restored ${result.restoredFiles} client file(s). Restart affected clients.`);
  } else {
    if (opts.json) printJson({ ...preview, dryRun: true });
    else {
      console.log(`Restore ${id} — dry run. No files written.`);
      console.log(
        table(
          ['client', 'file', 'action', 'review'],
          preview.files.map((f) => [
            f.client,
            f.path,
            f.action,
            f.conflict ? 'changed after sync' : 'ready',
          ]),
        ),
      );
      console.log(
        preview.blocked
          ? '\nBlocked: client configuration or sync state changed after this backup.'
          : `\nApply rollback:\n${preview.applyCommand}`,
      );
    }
    if (plan.blocked) process.exitCode = 1;
  }
}
