import fs from 'node:fs/promises';
import path from 'node:path';
import { stringify as stringifyYaml } from 'yaml';
import { HubError } from '../../shared/errors.js';
import { snapshot, writeChecked } from '../../shared/file-store.js';
import { exists } from '../../shared/fs.js';
import { addRemote, commitPaths, initRepo, isOwnRepo } from '../../shared/git.js';
import { withHubLock } from '../../shared/hub-lock.js';
import { ensureBaseline, recordExpectedWrites, type BaselineTarget } from '../recovery/baseline.js';
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

export type InitEvent =
  | { type: 'file'; name: 'hub.yaml' | '.env'; state: 'created' | 'kept' }
  | { type: 'git-init' }
  | { type: 'git-remote'; url: string }
  | { type: 'git-commit'; revision: string };
interface InitInput {
  root: string;
  fresh: boolean;
  enabled: Record<string, Record<string, unknown>>;
  targets: BaselineTarget[];
  gitAllowed: boolean;
  configureGit: () => Promise<{ enabled: boolean; remote: string }>;
  report: (event: InitEvent) => void;
}
export async function initializeHub(input: InitInput) {
  const { root, fresh, enabled, targets, gitAllowed, configureGit, report } = input;
  await withHubLock(root, async (origin) => {
    await ensureBaseline(root, targets, origin);
    if (gitAllowed && (await exists(path.join(root, '.git')))) {
      const metadata = await fs.lstat(path.join(root, '.git'));
      if (!metadata.isDirectory() || metadata.isSymbolicLink())
        throw new HubError(
          'Git metadata outside the hub cannot be included in a complete reset. Use --no-git for an existing worktree or linked repository.',
        );
    }
    for (const d of DIRS) await fs.mkdir(path.join(root, d), { recursive: true });
    await fs.chmod(root, 0o700).catch(() => undefined);

    const hubYaml = path.join(root, 'hub.yaml');
    if (!(await exists(hubYaml))) {
      await fs.writeFile(
        hubYaml,
        `# agent-hub settings\n${stringifyYaml({ version: 1, clients: enabled })}`,
        { flag: 'wx' },
      );
      report({ type: 'file', name: 'hub.yaml', state: 'created' });
    }

    const envFile = path.join(root, '.env');
    const envBefore = await snapshot(envFile);
    await recordExpectedWrites(root, [
      {
        before: { ...envBefore, mode: 0o600 },
        after: envBefore.content ?? '# agent-hub secrets — git-ignored. KEY=value\n',
      },
    ]);
    if (!(await exists(envFile))) {
      await fs.writeFile(envFile, '# agent-hub secrets — git-ignored. KEY=value\n', {
        mode: 0o600,
        flag: 'wx',
      });
      report({ type: 'file', name: '.env', state: 'created' });
    } else {
      await fs.chmod(envFile, 0o600);
      report({ type: 'file', name: '.env', state: 'kept' });
    }

    const gi = path.join(root, '.gitignore');
    const curGi = (await exists(gi)) ? await fs.readFile(gi, 'utf8') : '';
    const missing = GITIGNORE.split('\n').filter(
      (l) => l && !l.startsWith('#') && !curGi.split('\n').includes(l),
    );
    const giSnapshot = await snapshot(gi);
    if (!curGi || missing.length) {
      const after = !curGi ? GITIGNORE : `${curGi}\n${missing.join('\n')}\n`;
      await recordExpectedWrites(root, [{ before: giSnapshot, after }]);
      await writeChecked(giSnapshot, after);
    }

    const { enabled: wantGit, remote } = await configureGit();
    if (wantGit) {
      if (!isOwnRepo(root)) {
        initRepo(root);
        report({ type: 'git-init' });
      }
      if (remote) {
        addRemote(remote, root);
        report({ type: 'git-remote', url: remote });
      }
      const sha = commitPaths(
        ['hub.yaml', '.gitignore'],
        fresh ? 'hub: init' : 'hub: init (adopt existing)',
        root,
      );
      if (sha) report({ type: 'git-commit', revision: sha });
    }
  });
}
