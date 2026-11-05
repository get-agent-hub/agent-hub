import { syncCommand } from './definitions.js';
import type { SyncPlan } from './types.js';

export function publicSyncPlan(plan: SyncPlan) {
  return {
    revision: plan.revision,
    blocked: plan.blocked,
    commands: {
      dryRun: syncCommand(plan.context, plan.options, ['--dry-run']),
      apply: syncCommand(plan.context, plan.options, ['--apply', '--expect', plan.revision]),
    },
    files: plan.targets.map((t) => ({
      client: t.target.id,
      label: t.target.label,
      path: t.target.file,
      changed: t.next !== (t.snapshot.content ?? ''),
      problem: t.problem,
      rows: t.rows.map(({ config, ...row }) => ({
        ...row,
        config:
          config &&
          Object.fromEntries(
            ['serverName', 'type', 'transport', 'command', 'args', 'env']
              .filter((k) => k in config)
              .map((k) => [k, config[k]]),
          ),
        preservedSettings:
          config &&
          Object.keys(config).filter(
            (k) => !['serverName', 'type', 'transport', 'command', 'args', 'env'].includes(k),
          ),
      })),
    })),
  };
}
