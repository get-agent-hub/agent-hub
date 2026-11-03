import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawn } from 'node:child_process';

const source = fileURLToPath(new URL('../', import.meta.url));
const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ahub-global-install-'));
const prefix = path.join(directory, 'prefix');
const workspace = path.join(directory, 'unrelated-project');
const home = path.join(directory, 'hub');
let ui;
try {
  await fs.mkdir(workspace);
  await fs.mkdir(path.join(directory, 'codex'));
  await fs.writeFile(path.join(directory, 'codex', 'config.toml'), '# fixture only\n');
  await fs.writeFile(path.join(directory, 'npmrc'), '');
  const env = {
    ...process.env,
    PATH: [path.join(prefix, 'bin'), path.dirname(process.execPath), process.env.PATH].join(
      path.delimiter,
    ),
    AGENT_HUB_HOME: home,
    AGENT_HUB_CLAUDE_CONFIG: path.join(directory, 'claude.json'),
    CLAUDE_CONFIG_DIR: path.join(directory, 'claude'),
    CODEX_HOME: path.join(directory, 'codex'),
    DSH_HOME: path.join(directory, 'dsh'),
    AGENT_HUB_SHARED_SKILLS: path.join(directory, 'shared-skills'),
    AGENT_HUB_DSH_PROFILE: 'web',
    npm_config_userconfig: path.join(directory, 'npmrc'),
  };
  assert.ok(process.env.npm_execpath, 'Run through npm run install:check.');
  execFileSync(
    process.execPath,
    [
      process.env.npm_execpath,
      'install',
      '--global',
      '--prefix',
      prefix,
      '--cache',
      path.join(directory, 'cache'),
      '--offline',
      '--no-audit',
      '--no-fund',
      source,
    ],
    { cwd: workspace, env, stdio: 'pipe' },
  );

  const run = (args, name = 'ahub') =>
    execFileSync(name, args, { cwd: workspace, env, encoding: 'utf8' });
  assert.match(run(['--help']), /quick/);
  assert.equal(run(['--version']), run(['--version'], 'agent-hub'));
  const preview = JSON.parse(run(['quick', '--no-project', '--client', 'codex', '--json']));
  await assert.rejects(fs.access(home), { code: 'ENOENT' });
  const result = JSON.parse(
    run([
      'quick',
      '--no-project',
      '--client',
      'codex',
      '--apply',
      '--at',
      preview.at,
      '--expect',
      preview.revision,
      '--json',
    ]),
  );
  assert.equal(result.status, 'complete');
  assert.equal(result.root, home);
  assert.equal(JSON.parse(run(['status', '--json'])).hub.root, home);

  ui = spawn('ahub', ['ui', '--no-open', '--port', '0'], {
    cwd: workspace,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const url = await new Promise((resolve, reject) => {
    let output = '';
    const timeout = setTimeout(() => reject(new Error('Installed UI did not start.')), 10_000);
    ui.once('error', reject);
    ui.once('exit', () => {
      clearTimeout(timeout);
      reject(new Error('Installed UI exited before startup.'));
    });
    ui.stdout.on('data', (chunk) => {
      output += chunk;
      const found = output.match(/http:\/\/127\.0\.0\.1:\d+/);
      if (found) {
        clearTimeout(timeout);
        resolve(found[0]);
      }
    });
  });
  for (const asset of ['/', '/quick.js']) assert.equal((await fetch(`${url}${asset}`)).status, 200);
  const state = await (await fetch(`${url}/api/state`)).json();
  assert.equal(state.status.hub.root, home);
  console.log(
    'Global install verified in a temporary prefix: ahub + agent-hub, quick preview/apply, status and UI assets from an unrelated directory.',
  );
} finally {
  if (ui && ui.exitCode === null) {
    const stopped = new Promise((resolve) => ui.once('exit', resolve));
    ui.kill('SIGTERM');
    await stopped;
  }
  await fs.rm(directory, { recursive: true, force: true });
}
