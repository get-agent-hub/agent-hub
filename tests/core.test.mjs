import { recoveryRoot } from '../dist/core/recovery-paths.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseEnvText, renderEnvAppend } from '../dist/core/env.js';
import { snapshot, writeChecked } from '../dist/core/file-store.js';
import { writeTransaction } from '../dist/core/file-transaction.js';
import { withHubLock } from '../dist/core/hub-lock.js';
import { planImport, applyImport } from '../dist/core/import-plan.js';
import { parseRegistry } from '../dist/core/registry.js';
import { formatCommand } from '../dist/core/shell.js';
import { serviceHealthCheck } from '../dist/integrations/health-checks.js';
import { healthPill, serviceDetails } from '../ui/app/health.js';

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ahub-core-'));
  const previous = process.env.AGENT_HUB_HOME;
  process.env.AGENT_HUB_HOME = root;
  t.after(async () => {
    if (previous === undefined) delete process.env.AGENT_HUB_HOME;
    else process.env.AGENT_HUB_HOME = previous;
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(recoveryRoot(root), { recursive: true, force: true });
  });
  await fs.mkdir(path.join(root, 'mcp'));
  await fs.writeFile(path.join(root, '.env'), '# existing credentials\n', { mode: 0o600 });
  await fs.writeFile(path.join(root, 'mcp/servers.yaml'), 'version: 1\nservers: {}\n');
  const raw = {
    command: 'node',
    args: ['server.mjs'],
    env: { API_TOKEN: 'fixture-private-value' },
  };
  const sources = [
    {
      id: 'codex',
      label: 'Codex',
      detect: async () => ({ installed: true, paths: {} }),
      readMcpRaw: async () => [{ name: 'demo', raw, source: 'fixture' }],
    },
  ];
  return { root, raw, sources };
}

test('dotenv append round-trips quotes, newlines, literal escapes and Unicode without losing comments', () => {
  const vars = new Map(
    Object.entries({
      A: 'both \'" quotes',
      B: 'two\nlines\r\ntab\t',
      C: String.raw`literal\nC:\path\file`,
      D: 'Юникод # value',
      EMPTY: '',
    }),
  );
  const original = '# keep this comment\nEXISTING=keep';
  const rendered = renderEnvAppend(original, vars);
  const parsed = parseEnvText(rendered.content);
  for (const [key, value] of vars) assert.equal(parsed.get(key), value);
  assert.ok(rendered.content.startsWith(original + '\n'));
  assert.equal(renderEnvAppend(rendered.content, vars).content, rendered.content);
  assert.equal(parseEnvText("MULTI='first\nsecond'\n").get('MULTI'), 'first\nsecond');
  assert.throws(() => parseEnvText('TOKEN="unterminated'), /quoted/);
});

test('a failed multi-file update rolls back files already replaced', async (t) => {
  const { root } = await fixture(t);
  const first = path.join(root, 'first');
  const second = path.join(root, 'second');
  await fs.writeFile(first, 'original');
  const changes = [
    { before: await snapshot(first), after: 'replacement' },
    { before: await snapshot(second), after: 'new file' },
  ];
  await assert.rejects(
    writeTransaction(changes, async (before, after) => {
      if (before.file === second) throw new Error('fixture failure');
      await writeChecked(before, after);
    }),
    /rolled back/,
  );
  assert.equal(await fs.readFile(first, 'utf8'), 'original');
  await assert.rejects(fs.access(second));
});

test('import refuses stale hub or source inputs without changing credentials', async (t) => {
  const f = await fixture(t);
  const original = await fs.readFile(path.join(f.root, '.env'), 'utf8');
  const plan = await planImport('mcp', {}, f.sources);
  f.raw.args = ['changed.mjs'];
  await assert.rejects(applyImport(plan), /changed/);
  assert.equal(await fs.readFile(path.join(f.root, '.env'), 'utf8'), original);
  const next = await planImport('mcp', {}, f.sources);
  await fs.appendFile(path.join(f.root, 'mcp/servers.yaml'), '# external edit\n');
  await assert.rejects(applyImport(next), /changed/);
  assert.equal(await fs.readFile(path.join(f.root, '.env'), 'utf8'), original);
});

test('import rolls back credentials and registry if provenance cannot be saved', async (t) => {
  const f = await fixture(t);
  const plan = await planImport('mcp', {}, f.sources);
  const rename = fs.rename.bind(fs);
  t.mock.method(fs, 'rename', async (from, to) => {
    if (to === path.join(await fs.realpath(f.root), 'state/imported-definitions.json'))
      throw new Error('fixture failure');
    return rename(from, to);
  });
  await assert.rejects(applyImport(plan), /rolled back/);
  assert.equal(await fs.readFile(path.join(f.root, '.env'), 'utf8'), '# existing credentials\n');
  assert.equal(
    await fs.readFile(path.join(f.root, 'mcp/servers.yaml'), 'utf8'),
    'version: 1\nservers: {}\n',
  );
  await assert.rejects(fs.access(path.join(f.root, 'state/sync.lock')));
});

test('hub updates use one lock and release it after failure', async (t) => {
  const { root } = await fixture(t);
  let entered;
  let release;
  const ready = new Promise((resolve) => {
    entered = resolve;
  });
  const wait = new Promise((resolve) => {
    release = resolve;
  });
  const held = withHubLock(root, async () => {
    await withHubLock(root, async () => {}); // Dependent stages reuse their workflow lock.
    entered();
    await wait;
  });
  await ready;
  try {
    await assert.rejects(
      withHubLock(root, async () => {}),
      /Another hub update/,
    );
  } finally {
    release();
    await held;
  }
  await assert.rejects(
    withHubLock(root, async () => {
      throw new Error('fixture failure');
    }),
  );
  await withHubLock(root, async () => {});
});

test('invalid registry values fail closed without echoing raw configuration', () => {
  for (const raw of [
    'broken: [ private-secret',
    'version: 1\nservers:\n  demo:\n    args: wrong-private-value',
    'version: 1\nservers:\n  demo:\n    arbitrary: value',
  ]) {
    assert.throws(
      () => parseRegistry(raw),
      (error) => /Cannot parse/.test(error.message) && !error.message.includes('private'),
    );
  }
});

test('copyable commands preserve apostrophes, spaces and shell metacharacters', () => {
  const value = "a 'quote' $variable `substitution` ; & spaces";
  const text = formatCommand(
    { executable: process.execPath, args: ['-e', 'process.stdout.write(process.argv[1])', value] },
    'posix',
  );
  if (process.platform !== 'win32')
    assert.equal(execFileSync('/bin/sh', ['-c', text], { encoding: 'utf8' }), value);
  const windows = formatCommand(
    {
      executable: 'C:\\Program Files\\node.exe',
      args: ["it's safe", '$literal'],
      env: { AGENT_HUB_HOME: "C:\\a'b" },
    },
    'powershell',
  );
  assert.equal(
    windows,
    "$env:AGENT_HUB_HOME='C:\\a''b'; & 'C:\\Program Files\\node.exe' 'it''s safe' '$literal'",
  );
});

test('service configuration and UI support arbitrary services with escaped labels', () => {
  const config = serviceHealthCheck(
    { health: { name: '<private-service>', url: '${BASE}/ready' } },
    {},
    new Map([['BASE', 'https://service.example']]),
  );
  assert.deepEqual(config, { name: '<private-service>', url: 'https://service.example/ready' });
  const service = {
    name: '<private-service>',
    status: 'unavailable',
    message: '<script>example</script>',
  };
  const html = serviceDetails(service);
  assert.ok(html.includes('&lt;private-service&gt;'));
  assert.ok(!html.includes('<script>'));
  const pill = healthPill('demo', {
    stale: false,
    report: { results: [{ name: 'demo', status: 'ok', service }] },
  });
  assert.ok(pill.includes('&lt;private-service&gt; unavailable'));
  assert.ok(!pill.includes('n8n'));
});

test('CLI initialization and import leave unrelated staged work untouched', async (t) => {
  const f = await fixture(t);
  const git = (args) => execFileSync('git', args, { cwd: f.root, encoding: 'utf8', stdio: 'pipe' });
  git(['init', '-q', '-b', 'main']);
  git(['config', 'user.email', 'test@example.com']);
  git(['config', 'user.name', 'Fixture']);
  git(['config', 'commit.gpgsign', 'false']);
  git(['config', 'core.hooksPath', path.join(f.root, 'disabled-hooks')]);
  await fs.writeFile(path.join(f.root, 'notes.md'), 'existing notes');
  git(['add', 'notes.md']);
  git(['commit', '-qm', 'initial fixture']);
  await fs.writeFile(path.join(f.root, 'unrelated.txt'), 'unrelated staged work');
  git(['add', 'unrelated.txt']);
  const env = {
    ...process.env,
    AGENT_HUB_HOME: f.root,
    AGENT_HUB_CLAUDE_CONFIG: path.join(f.root, 'clients/claude.json'),
    CLAUDE_CONFIG_DIR: path.join(f.root, 'clients/claude'),
    CODEX_HOME: path.join(f.root, 'clients/codex'),
    DSH_HOME: path.join(f.root, 'clients/dsh'),
    AGENT_HUB_SHARED_SKILLS: path.join(f.root, 'clients/skills'),
  };
  execFileSync(process.execPath, [path.resolve('dist/cli.js'), 'init', '--yes'], {
    env,
    cwd: os.tmpdir(),
    stdio: 'pipe',
  });
  assert.equal(git(['diff', '--cached', '--name-only']).trim(), 'unrelated.txt');
  const before = git(['rev-parse', 'HEAD']);
  await applyImport(await planImport('mcp', {}, f.sources));
  assert.equal(git(['rev-parse', 'HEAD']), before);
  assert.equal(git(['diff', '--cached', '--name-only']).trim(), 'unrelated.txt');
});

test('URL credentials are extracted before a registry can be committed', async () => {
  const { extractSecrets, findLeftoverSecrets } = await import('../dist/core/importer.js');
  const url = 'https://user:fixture-password@example.com/mcp?token=fixture-query-token';
  const extracted = extractSecrets('demo', { url, args: [url, '--endpoint=' + url] }, new Map());
  assert.ok(!JSON.stringify(extracted.server).includes('fixture-password'));
  assert.ok(!JSON.stringify(extracted.server).includes('fixture-query-token'));
  assert.equal(extracted.secrets.get('DEMO_URL'), url);
  const numericName = extractSecrets('123-demo', { url }, new Map());
  assert.equal(numericName.secrets.get('_123_DEMO_URL'), url);
  assert.deepEqual(findLeftoverSecrets(extracted.server), []);
  assert.equal(
    extractSecrets('demo', { url: '${EXISTING_URL}' }, new Map()).server.url,
    '${EXISTING_URL}',
  );
});

test('production CLI completes import, copied sync, discovery and copied restore using isolated client locations', async (t) => {
  const f = await fixture(t);
  const clients = path.join(f.root, 'clients');
  const claude = path.join(clients, 'claude.json');
  const codex = path.join(clients, 'codex/config.toml');
  const dsh = path.join(clients, 'dsh/profiles/web/cordis.patch.yml');
  await fs.mkdir(path.dirname(codex), { recursive: true });
  await fs.mkdir(path.dirname(dsh), { recursive: true });
  const { stringify: toml } = await import('smol-toml');
  const originals = [
    JSON.stringify({ unrelated: true }),
    toml({
      model: 'fixture',
      mcp_servers: {
        demo: {
          command: process.execPath,
          args: [path.resolve('tests/fixtures/doctor-server.mjs')],
          env: { API_TOKEN: 'fixture-private-cli-token' },
        },
      },
    }),
    '[]\n',
  ];
  await Promise.all(
    [claude, codex, dsh].map((file, index) => fs.writeFile(file, originals[index])),
  );
  const env = {
    ...process.env,
    AGENT_HUB_HOME: f.root,
    AGENT_HUB_CLAUDE_CONFIG: claude,
    CLAUDE_CONFIG_DIR: path.join(clients, 'claude'),
    CODEX_HOME: path.dirname(codex),
    DSH_HOME: path.join(clients, 'dsh'),
    AGENT_HUB_SHARED_SKILLS: path.join(clients, 'skills'),
  };
  const cli = path.resolve('dist/cli.js');
  const run = (args) =>
    execFileSync(process.execPath, [cli, ...args], {
      env,
      cwd: os.tmpdir(),
      encoding: 'utf8',
      stdio: 'pipe',
    });
  const exact = (command) =>
    execFileSync('/bin/sh', ['-c', command + ' --json'], {
      env,
      cwd: os.tmpdir(),
      encoding: 'utf8',
      stdio: 'pipe',
    });
  run(['init', '--yes', '--no-git']);
  const importPreview = JSON.parse(run(['import', 'mcp', '--json']));
  assert.equal(importPreview.dryRun, true);
  const imported = JSON.parse(exact(importPreview.commands.apply));
  assert.equal(imported.result.imported, 1);
  assert.ok(!JSON.stringify(imported).includes('fixture-private-cli-token'));
  const preview = JSON.parse(run(['sync', '--json']));
  assert.equal(preview.blocked, false);
  assert.equal(preview.files.filter((file) => file.changed).length, 3);
  const synced = JSON.parse(exact(preview.commands.apply));
  assert.equal(synced.result.changedFiles, 3);
  const status = JSON.parse(run(['status', '--json']));
  assert.equal(status.drift.length, 0);
  const doctor = JSON.parse(run(['doctor', 'demo', '--timeout', '4', '--json']));
  assert.equal(doctor.results[0].tools, 3);
  assert.ok(JSON.parse(run(['sync', '--json'])).files.every((file) => !file.changed));
  const restore = JSON.parse(run(['restore', synced.result.backup, '--json']));
  assert.equal(JSON.parse(exact(restore.applyCommand)).restoredFiles, 3);
  for (const [index, file] of [claude, codex, dsh].entries())
    assert.equal(await fs.readFile(file, 'utf8'), originals[index]);
});

test('remote launch preserves proxy routing without copying unrelated hub credentials into the process environment', async () => {
  const { buildLaunch } = await import('../dist/core/launch.js');
  const variables = new Map([
    ['HTTP_PROXY', 'http://proxy.example:8080'],
    ['HTTPS_PROXY', 'http://proxy.example:8080'],
    ['NO_PROXY', 'localhost,127.0.0.1'],
    ['OTHER_API_TOKEN', 'unrelated-fixture-token'],
  ]);
  const launch = buildLaunch(
    { transport: 'http', url: 'https://service.example/mcp', proxy: true },
    variables,
  );
  assert.ok(launch.args.includes('--enable-proxy'));
  assert.ok(launch.args.includes('http-only'));
  for (const key of ['HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY'])
    assert.equal(launch.env[key], variables.get(key));
  assert.equal(launch.env.OTHER_API_TOKEN, undefined);
  assert.equal(launch.missing.size, 0);
});

test('re-import recognizes marked launchers from an earlier package path instead of nesting them', async () => {
  const { collectCandidates } = await import('../dist/core/importer.js');
  const raw = {
    command: '/old/runtime/node',
    args: ['/old/package/dist/cli.js', 'mcp', 'run', 'demo'],
    env: { AGENT_HUB_HOME: '/some/hub' },
  };
  assert.equal(
    collectCandidates([{ client: 'codex', items: [{ name: 'demo', raw, source: 'fixture' }] }])
      .size,
    0,
  );
  assert.equal(
    collectCandidates([
      { client: 'codex', items: [{ name: 'demo', raw: { ...raw, env: {} }, source: 'fixture' }] },
    ]).size,
    1,
  );
});
