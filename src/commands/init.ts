import { adapters } from '../adapters/index.js';
import { initializeHub, type InitEvent } from '../core/setup/init.js';
import { exists } from '../shared/fs.js';
import { c } from '../shared/output.js';
import { hubRoot, tildify } from '../shared/paths.js';
import { ask, confirm } from '../shared/prompt.js';

export async function initCommand(opts: {
  yes?: boolean;
  remote?: string;
  git?: boolean;
}): Promise<void> {
  const root = hubRoot();
  const fresh = !(await exists(root));
  console.log(
    c.bold(
      fresh
        ? `Creating hub at ${tildify(root)}`
        : `Hub exists at ${tildify(root)} — upgrading in place (nothing is deleted)`,
    ),
  );

  const detected = await Promise.all(adapters.map(async (a) => ({ a, d: await a.detect() })));
  const enabled: Record<string, Record<string, unknown>> = {};
  for (const { a, d } of detected) {
    const on =
      d.installed &&
      (opts.yes ||
        (await confirm(
          `  Manage ${a.label}? (${d.installed ? 'found' : 'not found'})`,
          d.installed,
        )));
    console.log(
      `  ${on ? c.green('✓') : c.dim('·')} ${a.label}${d.installed ? '' : c.dim(' — not found')}`,
    );
    enabled[a.id] = {
      enabled: on,
      ...(a.id === 'dsh' ? { profile: process.env.AGENT_HUB_DSH_PROFILE ?? 'web' } : {}),
    };
  }

  await initializeHub({
    root,
    fresh,
    enabled,
    targets: detected.flatMap(({ a, d }) => {
      const file = d.paths.config ?? d.paths.profilePatch;
      return typeof file === 'string' ? [{ file, client: a.id, installed: d.installed }] : [];
    }),
    gitAllowed: opts.git !== false,
    configureGit: async () => {
      const on =
        opts.git !== false && (opts.yes || (await confirm('  Track hub in git (local)?', true)));
      return {
        enabled: !!on,
        remote: on
          ? (opts.remote ?? (opts.yes ? '' : await ask('  Remote URL (optional, Enter to skip):')))
          : '',
      };
    },
    report: reportInit,
  });

  console.log(
    `\nNext: ${c.cyan('ahub import --dry-run')} to pull MCP servers from your clients into the hub.`,
  );
}

function reportInit(event: InitEvent) {
  if (event.type === 'file') {
    const note =
      event.name === '.env'
        ? event.state === 'kept'
          ? c.dim('kept, permissions set to 600')
          : c.dim('(600)')
        : '';
    console.log(
      event.state === 'kept'
        ? `  ${c.dim('=')} ${event.name} ${note}`
        : `  ${c.green('+')} ${event.name}${note ? ' ' + note : ''}`,
    );
  } else if (event.type === 'git-init') console.log(`  ${c.green('+')} git repo`);
  else if (event.type === 'git-remote') console.log(`  ${c.green('+')} remote origin ${event.url}`);
  else console.log(`  ${c.green('✓')} committed ${event.revision}`);
}
