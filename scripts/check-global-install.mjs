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
let stopBackground;
try {
  await fs.mkdir(workspace);
  execFileSync('git', ['init', '-q', workspace]);
  await fs.mkdir(path.join(directory, 'codex'));
  await fs.writeFile(path.join(directory, 'codex', 'config.toml'), '# fixture only\n');
  await fs.writeFile(path.join(directory, 'npmrc'), '');
  const collection = path.join(directory, 'claude', 'projects', 'fixture');
  await fs.mkdir(collection, { recursive: true });
  await fs.writeFile(
    path.join(collection, 'fixture.jsonl'),
    JSON.stringify({
      type: 'user',
      sessionId: 'installed-fixture',
      cwd: workspace,
      message: { role: 'user', content: 'Installed history sentinel' },
    }) + '\n',
  );
  const env = {
    ...process.env,
    PATH: [path.join(prefix, 'bin'), path.dirname(process.execPath), process.env.PATH].join(
      path.delimiter,
    ),
    AGENT_HUB_HOME: home,
    AGENT_HUB_TELEMETRY_STATE: path.join(directory, 'telemetry.json'),
    AGENT_HUB_TELEMETRY_DISABLED: '1',
    AGENT_HUB_CLAUDE_CONFIG: path.join(directory, 'claude.json'),
    CLAUDE_CONFIG_DIR: path.join(directory, 'claude'),
    CODEX_HOME: path.join(directory, 'codex'),
    DSH_HOME: path.join(directory, 'dsh'),
    AGENT_HUB_SHARED_SKILLS: path.join(directory, 'shared-skills'),
    AGENT_HUB_DSH_PROFILE: 'web',
    npm_config_userconfig: path.join(directory, 'npmrc'),
    npm_config_prefix: prefix,
    npm_config_cache: path.join(directory, 'npm-cache'),
  };
  assert.ok(process.env.npm_execpath, 'Run through npm run install:check.');
  execFileSync(process.execPath, ['scripts/install-global.mjs'], {
    cwd: source,
    env,
    stdio: 'pipe',
  });
  const installedPackage = path.join(prefix, 'lib/node_modules/agent-hub');
  assert.equal((await fs.lstat(installedPackage)).isSymbolicLink(), false);
  assert.ok((await fs.stat(path.join(installedPackage, 'npm-shrinkwrap.json'))).isFile());
  assert.ok(!(await fs.realpath(installedPackage)).startsWith(source));
  assert.ok(await fs.stat(path.join(installedPackage, 'node_modules/yaml/package.json')));

  const run = (args, name = 'ahub') =>
    execFileSync(name, args, { cwd: workspace, env, encoding: 'utf8' });
  stopBackground = () => run(['history', 'watch', '--stop']);
  assert.match(run(['--help']), /quick/);
  const metadata = JSON.parse(await fs.readFile(path.join(source, 'package.json'), 'utf8'));
  assert.equal(run(['--version']).trim(), metadata.version);
  assert.equal(run(['--version']), run(['--version'], 'agent-hub'));
  const preview = JSON.parse(run(['quick', '--client', 'codex', '--json']));
  await assert.rejects(fs.access(home), { code: 'ENOENT' });
  const result = JSON.parse(
    run([
      'quick',
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
  assert.equal(result.scope, 'hub');
  await assert.rejects(fs.access(path.join(workspace, 'AGENTS.md')), { code: 'ENOENT' });
  const project = JSON.parse(run(['project', 'connect', '--json']));
  assert.equal(project.scope, 'project');
  assert.equal(project.workspace, await fs.realpath(workspace));
  assert.equal(JSON.parse(run(['status', '--json'])).hub.root, home);
  assert.equal(JSON.parse(run(['history', 'scan', '--client', 'claude-code'])).chats, 1);
  const history = JSON.parse(run(['history', 'ls']));
  assert.equal(history.chats[0].events, 1);
  const handoff = JSON.parse(run(['history', 'handoff', history.chats[0].id, '--client', 'codex']));
  assert.match(handoff.text, /Installed history sentinel/);
  assert.equal(handoff.revision, history.chats[0].revision);
  assert.equal(JSON.parse(run(['history', 'watch', '--background'])).running, true);
  let background;
  for (let attempt = 0; attempt < 100; attempt++) {
    background = JSON.parse(run(['history', 'status'])).background;
    if (background.lastSuccess) break;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.ok(background.lastSuccess, 'Installed worker performs a checked capture');
  assert.equal(JSON.parse(stopBackground()).running, false);
  assert.equal(JSON.parse(run(['history', 'search', 'Installed history sentinel'])).total, 1);
  assert.equal(
    JSON.parse(run(['history', 'show', history.chats[0].id])).events[0].text,
    'Installed history sentinel',
  );
  const connection = JSON.parse(
    run(['history', 'connect', history.chats[0].projects[0], '--client', 'codex']),
  );
  const connected = JSON.parse(
    run([
      'history',
      'connect',
      history.chats[0].projects[0],
      '--client',
      'codex',
      '--apply',
      '--expect',
      connection.revision,
    ]),
  );
  assert.equal(connected.status, 'complete');

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
  for (const asset of [
    '/',
    '/app.js',
    '/shared/navigation.js',
    '/shared/view.js',
    '/shared/en.js',
    '/pages/overview.js',
    '/pages/sources.js',
    '/pages/resources.js',
    '/pages/mcp.js',
    '/entities/mcp.js',
    '/styles/mcp.css',
    '/features/quick.js',
    '/features/projects.js',
    '/features/history.js',
    '/features/history-handoff.js',
    '/features/history-startup.js',
    '/features/import-mcp.js',
    '/features/sync-mcp.js',
    '/features/check-mcp.js',
    '/features/content.js',
    '/features/memory.js',
    '/entities/health.js',
    '/entities/resource.js',
    '/entities/history-project.js',
    '/entities/history-conversation.js',
    '/entities/history-sources.js',
    '/app.css',
    '/base.css',
    '/styles/primitives.css',
    '/styles/tables.css',
    '/styles/resources.css',
    '/styles/dialogs.css',
    '/styles/history.css',
    '/styles/shell.css',
    '/styles/pages.css',
    '/styles/responsive.css',
  ])
    assert.equal((await fetch(`${url}${asset}`)).status, 200);
  const state = await (await fetch(`${url}/api/state`)).json();
  if (state.status.mcp[0])
    assert.equal(
      (await fetch(`${url}/api/mcp?${new URLSearchParams({ name: state.status.mcp[0].name })}`))
        .status,
      200,
    );
  assert.equal(state.status.hub.root, home);
  const post = async (route, body) => {
    const response = await fetch(`${url}${route}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Agent-Hub-Token': state.token },
      body: JSON.stringify(body),
    });
    assert.ok(response.ok, `${route}: ${response.status}`);
    return response.json();
  };
  let scan = await post('/api/projects/discovery/start', { clients: ['claude-code'] });
  for (let attempt = 0; scan.state === 'running' && attempt < 100; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 25));
    scan = await post('/api/projects/discovery/status', { id: scan.id });
  }
  assert.equal(scan.state, 'complete');
  assert.equal(scan.coverage, 'complete');
  assert.equal(scan.projects.length, 1);
  assert.equal(scan.projects[0].locations[0], await fs.realpath(workspace));
  const stopped = new Promise((resolve) => ui.once('exit', resolve));
  ui.kill('SIGTERM');
  await stopped;
  ui = undefined;
  stopBackground();
  stopBackground = undefined;

  const preservedPaths = [
    path.join(home, 'hub.yaml'),
    path.join(home, 'mcp', 'servers.yaml'),
    path.join(home, 'state', 'history', 'catalog.json'),
    path.join(directory, 'codex', 'config.toml'),
    path.join(collection, 'fixture.jsonl'),
  ];
  const preserved = await Promise.all(preservedPaths.map((file) => fs.readFile(file)));
  execFileSync(process.execPath, ['scripts/install-global.mjs'], {
    cwd: source,
    env,
    stdio: 'pipe',
  });
  assert.equal(run(['--version']).trim(), metadata.version);
  assert.equal(JSON.parse(run(['history', 'ls'])).chats[0].id, history.chats[0].id);
  for (const [index, file] of preservedPaths.entries())
    assert.deepEqual(await fs.readFile(file), preserved[index], `Reinstall preserved ${file}`);

  execFileSync(process.execPath, [process.env.npm_execpath, 'uninstall', '--global', 'agent-hub'], {
    cwd: workspace,
    env,
    stdio: 'pipe',
  });
  for (const target of [
    installedPackage,
    path.join(prefix, 'bin', 'ahub'),
    path.join(prefix, 'bin', 'agent-hub'),
  ])
    await assert.rejects(fs.lstat(target), { code: 'ENOENT' });
  for (const [index, file] of preservedPaths.entries())
    assert.deepEqual(await fs.readFile(file), preserved[index], `Uninstall retained ${file}`);
  console.log(
    'Temporary-prefix lifecycle passed: standalone install, both binaries, quick preview/apply, archive/search/handoff, background start/stop, scoped connection and UI; reinstall preserves data/settings; uninstall removes binaries without implicitly deleting archive or restoring client settings.',
  );
} finally {
  if (stopBackground) stopBackground();
  if (ui && ui.exitCode === null) {
    const stopped = new Promise((resolve) => ui.once('exit', resolve));
    ui.kill('SIGTERM');
    await stopped;
  }
  await fs.rm(directory, { recursive: true, force: true });
}
