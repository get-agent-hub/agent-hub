// Build first. Installs the actual tarball in an isolated temporary project.
// Defaults to offline; --online allows dependency downloads when the npm cache is incomplete.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';

const exec = promisify(execFile);
const source = fileURLToPath(new URL('..', import.meta.url));
const directory = await fs.realpath(
  await fs.mkdtemp(path.join(os.tmpdir(), 'ahub-install-check-')),
);
try {
  const { stdout } = await exec(
    'npm',
    ['pack', '--ignore-scripts', '--json', '--pack-destination', directory],
    { cwd: source },
  );
  const [archive] = JSON.parse(stdout);
  const install = path.join(directory, 'installation');
  await fs.mkdir(install);
  await fs.writeFile(
    path.join(install, 'package.json'),
    JSON.stringify({ name: 'isolated-hub-check', version: '1.0.0', private: true }),
  );
  await exec(
    'npm',
    [
      'install',
      ...(process.argv.includes('--online')
        ? ['--fetch-timeout=15000', '--fetch-retries=0']
        : ['--offline']),
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      path.join(directory, archive.filename),
    ],
    { cwd: install },
  );
  const installed = path.join(install, 'node_modules', 'agent-hub');
  const cli = path.join(installed, 'dist', 'cli.js');
  const env = {
    ...process.env,
    AGENT_HUB_HOME: path.join(directory, 'hub'),
    CLAUDE_CONFIG_DIR: path.join(directory, 'claude'),
    CODEX_HOME: path.join(directory, 'codex'),
    DSH_HOME: path.join(directory, 'dsh'),
    AGENT_HUB_DSH_PROFILE: 'fixture',
  };
  const run = async (args, cwd = install) =>
    (await exec(process.execPath, [cli, ...args], { cwd, env })).stdout;
  await run(['init', '--yes', '--no-git']);
  const workspace = path.join(directory, 'project');
  await fs.mkdir(workspace);
  await exec('git', ['init', '-q', workspace]);
  const replay = async (args) => {
    const preview = JSON.parse(await run([...args, '--dry-run', '--json']));
    assert.match(preview.revision, /^[a-f0-9]{64}$/);
    return JSON.parse(await run([...args, '--apply', '--expect', preview.revision, '--json']));
  };
  await replay(['memory', 'project', 'register', 'example', workspace]);
  const body = path.join(directory, 'fact.md');
  await fs.writeFile(body, 'Knowledge from the installed package.');
  await replay([
    'memory',
    'add',
    'installed-fact',
    '--workspace',
    workspace,
    '--title',
    'Installed fact',
    '--file',
    body,
    '--at',
    '2026-01-01T00:00:00.000Z',
  ]);
  const record = JSON.parse(
    await run(['memory', 'get', 'installed-fact', '--workspace', workspace, '--json']),
  );
  assert.equal(record.body, 'Knowledge from the installed package.');
  const { createMemorySession } = await import(
    pathToFileURL(path.join(installed, 'dist', 'core', 'memory-session.js'))
  );
  assert.equal(
    (await createMemorySession({ root: env.AGENT_HUB_HOME, workspace }).list()).total,
    1,
  );
  const native = path.join(workspace, '.dsh', 'memory');
  await fs.mkdir(native, { recursive: true });
  await fs.writeFile(
    path.join(native, 'MEMORY.md'),
    '# Existing decision\nKeep this inline native fact.\n',
  );
  const discovery = JSON.parse(
    await run(['memory', 'discover', '--workspace', workspace, '--json']),
  );
  assert.equal(discovery.sources.find((item) => item.path === native).projectId, 'example');
  await replay([
    'memory',
    'onboard',
    '--workspace',
    workspace,
    '--follow',
    '--at',
    '2026-01-01T00:00:00.000Z',
  ]);
  assert.equal(
    (await createMemorySession({ root: env.AGENT_HUB_HOME, workspace }).list()).total,
    2,
  );
  await replay(['memory', 'auto', 'enable', '--workspace', workspace, '--client', 'dsh']);
  const patch = await fs.readFile(
    path.join(env.DSH_HOME, 'profiles', env.AGENT_HUB_DSH_PROFILE, 'cordis.patch.yml'),
    'utf8',
  );
  assert.ok(
    patch.includes(
      pathToFileURL(path.join(installed, 'dist', 'integrations', 'dsh-memory.js')).href,
    ),
  );
  assert.equal(
    patch.includes(source),
    false,
    'The installed adapter must never fall back to the source checkout',
  );
  await fs.access(path.join(installed, 'ui', 'app', 'memory.js'));
  console.log(
    `Clean ${process.argv.includes('--online') ? 'registry-backed' : 'offline'} installation passed: ${archive.filename}; CLI previews/apply, scoped reads, native DSH adapter path and UI assets.`,
  );
} finally {
  await fs.rm(directory, { recursive: true, force: true });
}
