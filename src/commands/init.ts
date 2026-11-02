import { withHubLock } from '../core/hub-lock.js';
import { snapshot, writeChecked } from '../core/file-store.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { stringify as stringifyYaml } from 'yaml';
import { adapters } from '../adapters/index.js';
import { exists } from '../core/fs.js';
import { addRemote, commitPaths, initRepo, isOwnRepo } from '../core/git.js';
import { c } from '../core/output.js';
import { hubRoot, tildify } from '../core/paths.js';
import { ask, confirm } from '../core/prompt.js';

const DIRS = ['skills', 'mcp', 'instructions', 'memory', 'templates', 'backups', 'state'];

const GITIGNORE = `# agent-hub — never commit secrets or machine-local state
.env
.env.*
backups/
legacy/
state/
*.log
*.tmp
.DS_Store
`;

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

  // 1. clients
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

  await withHubLock(root, async () => {
    // 2. layout
    for (const d of DIRS) await fs.mkdir(path.join(root, d), { recursive: true });
    await fs.chmod(root, 0o700).catch(() => undefined);

    const hubYaml = path.join(root, 'hub.yaml');
    if (!(await exists(hubYaml))) {
      await fs.writeFile(
        hubYaml,
        `# agent-hub settings\n${stringifyYaml({ version: 1, clients: enabled })}`,
        { flag: 'wx' },
      );
      console.log(`  ${c.green('+')} hub.yaml`);
    }

    const envFile = path.join(root, '.env');
    if (!(await exists(envFile))) {
      await fs.writeFile(envFile, '# agent-hub secrets — git-ignored. KEY=value\n', {
        mode: 0o600,
        flag: 'wx',
      });
      console.log(`  ${c.green('+')} .env ${c.dim('(600)')}`);
    } else {
      await fs.chmod(envFile, 0o600);
      console.log(`  ${c.dim('=')} .env ${c.dim('kept, permissions set to 600')}`);
    }

    const gi = path.join(root, '.gitignore');
    const curGi = (await exists(gi)) ? await fs.readFile(gi, 'utf8') : '';
    const missing = GITIGNORE.split('\n').filter(
      (l) => l && !l.startsWith('#') && !curGi.split('\n').includes(l),
    );
    const giSnapshot = await snapshot(gi);
    if (!curGi) await writeChecked(giSnapshot, GITIGNORE);
    else if (missing.length) await writeChecked(giSnapshot, `${curGi}\n${missing.join('\n')}\n`);

    // 4. git
    const wantGit =
      opts.git !== false && (opts.yes || (await confirm('  Track hub in git (local)?', true)));
    if (wantGit) {
      if (!isOwnRepo(root)) {
        initRepo();
        console.log(`  ${c.green('+')} git repo`);
      }
      const remote =
        opts.remote ?? (opts.yes ? '' : await ask('  Remote URL (optional, Enter to skip):'));
      if (remote) {
        addRemote(remote);
        console.log(`  ${c.green('+')} remote origin ${remote}`);
      }
      const sha = commitPaths(
        ['hub.yaml', '.gitignore'],
        fresh ? 'hub: init' : 'hub: init (adopt existing)',
      );
      if (sha) console.log(`  ${c.green('✓')} committed ${sha}`);
    }
  });

  console.log(
    `\nNext: ${c.cyan('ahub import --dry-run')} to pull MCP servers from your clients into the hub.`,
  );
}
