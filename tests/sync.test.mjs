import { recoveryRoot } from '../dist/core/recovery-paths.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { parse, stringify } from 'yaml';
import { parse as parseToml } from 'smol-toml';
import { planSync, applySync, publicSyncPlan } from '../dist/core/sync.js';
import { planRestore, applyRestore, publicRestorePlan } from '../dist/core/restore.js';
import { readDefinitions, editDefinitions } from '../dist/core/config-edit.js';
import { startUiServer } from '../dist/ui/server.js';
import { collectCandidates } from '../dist/core/importer.js';
import { collectStatus } from '../dist/core/status.js';
import { toMcpEntry } from '../dist/core/mcp.js';
import { planImport, applyImport } from '../dist/core/import-plan.js';

const cli = path.resolve('dist/cli.js');
const secret = 'fixture-secret-never-shown-to-the-browser';
const original = {
  'claude-code':
    JSON.stringify(
      {
        theme: 'dark',
        oauth: secret,
        mcpServers: {
          demo: { command: 'fixture-mcp', args: ['serve'], env: { API_TOKEN: secret } },
          unrelated: { command: 'leave-me' },
        },
      },
      null,
      2,
    ) + '\n',
  codex: `# Keep this heading\nmodel = "keep-model"\nnotes = """\n[mcp_servers.this_is_a_string]\n"""\n\n[mcp_servers.demo]\ncommand = "fixture-mcp"\nargs = ["serve"]\nenabled = false\nstartup_timeout_sec = 42\n[mcp_servers.demo.env]\nAPI_TOKEN = "${secret}"\n[mcp_servers.demo.tools.write]\napproval_mode = "prompt"\n\n# Keep this unrelated block\n[mcp_servers.unrelated]\ncommand = "leave-me"\n\n# Keep this project comment\n[projects."/tmp/project"]\ntrust_level = "trusted"\n`,
  dsh: `# Keep the UI preference\n- id: ui-settings\n  name: keep-ui-plugin\n  config:\n    theme: dark\n- insert:\n    - id: user-demo\n      name: '@deepseek-ai/dsh-mcp-client'\n      config:\n        serverName: demo\n        transport: stdio\n        command: fixture-mcp\n        args: [serve]\n        env:\n          API_TOKEN: '${secret}'\n    - id: unrelated\n      name: '@deepseek-ai/dsh-mcp-client'\n      config:\n        serverName: unrelated\n        transport: stdio\n        command: leave-me\n`,
};

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ahub-sync-'space "));
  t.after(async () => {
    await fs.chmod(path.join(root, 'claude'), 0o700).catch(() => undefined);
    await fs.rm(root, { recursive: true, force: true });
    await fs
      .chmod(path.join(recoveryRoot(root), 'baseline/hub/claude'), 0o700)
      .catch(() => undefined);
    await fs.rm(recoveryRoot(root), { recursive: true, force: true });
  });
  const context = {
    root,
    node: process.execPath,
    cli,
    targets: [
      {
        id: 'claude-code',
        label: 'Claude Code',
        file: path.join(root, 'claude', 'settings.json'),
        installed: true,
      },
      {
        id: 'codex',
        label: 'Codex CLI',
        file: path.join(root, 'codex', 'config.toml'),
        installed: true,
      },
      {
        id: 'dsh',
        label: 'DeepSeek Harness',
        file: path.join(root, 'dsh', 'profiles', 'web', 'cordis.patch.yml'),
        installed: true,
      },
    ],
  };
  await fs.mkdir(path.join(root, 'mcp'), { recursive: true });
  await fs.writeFile(
    path.join(root, 'hub.yaml'),
    stringify({
      version: 1,
      clients: Object.fromEntries(context.targets.map((c) => [c.id, { enabled: true }])),
    }),
  );
  await fs.writeFile(path.join(root, '.env'), `API_TOKEN=${secret}\n`, { mode: 0o600 });
  await fs.writeFile(
    path.join(root, 'mcp', 'servers.yaml'),
    stringify({
      version: 1,
      servers: {
        demo: {
          command: 'fixture-mcp',
          args: ['serve'],
          env: { API_TOKEN: '${API_TOKEN}' },
          clients: { codex: { enabled: true, tools: { write: { approval_mode: 'approve' } } } },
        },
      },
    }),
  );
  for (const c of context.targets) {
    await fs.mkdir(path.dirname(c.file), { recursive: true });
    await fs.writeFile(c.file, original[c.id], { mode: 0o600 });
  }
  return { root, context, file: (id) => context.targets.find((c) => c.id === id).file };
}

test('dry run has no side effects and exposes exact safe commands', async (t) => {
  const f = await fixture(t);
  const plan = await planSync({}, f.context);
  const preview = publicSyncPlan(plan);
  assert.equal(plan.blocked, false);
  assert.deepEqual(
    preview.files.map((v) => v.client),
    ['dsh', 'codex', 'claude-code'],
  );
  assert.equal(preview.files.filter((v) => v.changed).length, 3);
  assert.ok(!JSON.stringify(preview).includes(secret));
  assert.match(preview.commands.apply, /--expect/);
  assert.match(preview.commands.dryRun, /--dry-run/);
  assert.ok(preview.commands.apply.includes(`'"'"'`));
  for (const c of f.context.targets)
    assert.equal(await fs.readFile(c.file, 'utf8'), original[c.id]);
  await assert.rejects(fs.access(path.join(f.root, 'backups')));
  await assert.rejects(fs.access(path.join(f.root, 'state')));
});

test('sync preserves unrelated settings, comments, local permissions, and creates private restorable backups', async (t) => {
  const f = await fixture(t);
  const result = await applySync(await planSync({}, f.context));
  assert.equal(result.changedFiles, 3);
  const claude = JSON.parse(await fs.readFile(f.file('claude-code'), 'utf8'));
  assert.equal(claude.oauth, secret);
  assert.equal(claude.theme, 'dark');
  assert.deepEqual(claude.mcpServers.unrelated, { command: 'leave-me' });
  const codexText = await fs.readFile(f.file('codex'), 'utf8');
  assert.ok(
    codexText.startsWith(
      '# Keep this heading\nmodel = "keep-model"\nnotes = """\n[mcp_servers.this_is_a_string]\n"""',
    ),
  );
  assert.ok(
    codexText.includes(
      '# Keep this unrelated block\n[mcp_servers.unrelated]\ncommand = "leave-me"',
    ),
  );
  assert.ok(
    codexText.includes(
      '# Keep this project comment\n[projects."/tmp/project"]\ntrust_level = "trusted"',
    ),
  );
  const codex = parseToml(codexText);
  assert.equal(codex.mcp_servers.demo.enabled, false);
  assert.equal(codex.mcp_servers.demo.startup_timeout_sec, 42);
  assert.equal(codex.mcp_servers.demo.tools.write.approval_mode, 'prompt');
  assert.equal(codex.mcp_servers.demo.env.API_TOKEN, undefined);
  assert.equal(codex.mcp_servers.demo.env.AGENT_HUB_HOME, f.root);
  assert.ok((await fs.readFile(f.file('dsh'), 'utf8')).startsWith('# Keep the UI preference'));
  const dsh = parse(await fs.readFile(f.file('dsh'), 'utf8'));
  assert.equal(dsh[0].config.theme, 'dark');
  assert.equal(dsh[1].insert[1].config.command, 'leave-me');
  for (const c of f.context.targets) {
    const defs = readDefinitions(c.id, await fs.readFile(c.file, 'utf8'));
    assert.equal(defs.get('demo').command, process.execPath);
    assert.deepEqual(defs.get('demo').args, [cli, 'mcp', 'run', 'demo']);
  }
  const backup = path.join(f.root, 'backups', result.backup);
  assert.equal((await fs.stat(backup)).mode & 0o777, 0o700);
  assert.equal((await fs.stat(path.join(backup, '0.conf'))).mode & 0o777, 0o600);
  assert.match(result.restoreCommand, /restore/);
  const restore = await planRestore(result.backup, f.context);
  assert.equal(restore.blocked, false);
  assert.ok(!JSON.stringify(publicRestorePlan(restore)).includes(secret));
  await applyRestore(restore);
  for (const c of f.context.targets)
    assert.equal(await fs.readFile(c.file, 'utf8'), original[c.id]);
  await assert.rejects(fs.access(path.join(f.root, 'state', 'sync.json')));
});

test('second sync is idempotent; unowned entries remain untouched', async (t) => {
  const f = await fixture(t);
  await applySync(await planSync({}, f.context));
  const plan = await planSync({}, f.context);
  assert.equal(plan.blocked, false);
  assert.ok(publicSyncPlan(plan).files.every((v) => !v.changed));
  assert.equal((await applySync(plan)).changedFiles, 0);
  for (const c of f.context.targets)
    assert.equal(
      readDefinitions(c.id, await fs.readFile(c.file, 'utf8')).get('unrelated').command,
      'leave-me',
    );
});

test('re-import after sync does not turn hub launchers into recursive server definitions', async (t) => {
  const f = await fixture(t);
  await applySync(await planSync({}, f.context));
  const raws = await Promise.all(
    f.context.targets.map(async (c) => ({
      client: c.id,
      items: [...readDefinitions(c.id, await fs.readFile(c.file, 'utf8'))].map(([name, raw]) => ({
        name,
        raw,
        source: c.file,
      })),
    })),
  );
  const candidates = collectCandidates(raws);
  assert.ok(!candidates.has('demo'));
  assert.ok(candidates.has('unrelated'));
});

test('status compares resolved references and hub launchers semantically, respecting app-owned scope', async (t) => {
  const f = await fixture(t);
  const previous = process.env.AGENT_HUB_HOME;
  process.env.AGENT_HUB_HOME = f.root;
  t.after(() => {
    if (previous === undefined) delete process.env.AGENT_HUB_HOME;
    else process.env.AGENT_HUB_HOME = previous;
  });
  const sources = f.context.targets.map((target) => ({
    id: target.id,
    label: target.label,
    detect: async () => ({ installed: true, paths: { config: target.file } }),
    async readMcpRaw() {
      return [...readDefinitions(target.id, await fs.readFile(target.file, 'utf8'))].map(
        ([name, raw]) => ({ name, raw, source: target.file }),
      );
    },
    async read() {
      return {
        client: target.id,
        skills: [],
        mcp: (await this.readMcpRaw()).map((r) => toMcpEntry(r.name, r.raw, r.source)),
      };
    },
  }));
  assert.ok(!(await collectStatus(sources)).drift.some((d) => d.name === 'demo'));
  await applySync(await planSync({}, f.context));
  assert.ok(!(await collectStatus(sources)).drift.some((d) => d.name === 'demo'));
  const reg = parse(await fs.readFile(path.join(f.root, 'mcp', 'servers.yaml'), 'utf8'));
  reg.servers.node_repl = {
    command: '/Applications/ChatGPT.app/Contents/Resources/node_repl',
    only: ['codex'],
  };
  await fs.writeFile(path.join(f.root, 'mcp', 'servers.yaml'), stringify(reg));
  assert.ok(!(await collectStatus(sources)).drift.some((d) => d.name === 'node_repl'));
});

test('blocks unknown local differences and stale plans without overwriting clients', async (t) => {
  const f = await fixture(t);
  const plan = await planSync({}, f.context);
  const changed = JSON.parse(original['claude-code']);
  changed.mcpServers.demo.command = 'locally-modified';
  await fs.writeFile(f.file('claude-code'), JSON.stringify(changed));
  await assert.rejects(applySync(plan), /changed since/);
  const next = await planSync({}, f.context);
  assert.equal(next.blocked, true);
  assert.equal(
    publicSyncPlan(next)
      .files.find((v) => v.client === 'claude-code')
      .rows.find((r) => r.name === 'demo').action,
    'conflict',
  );
  await assert.rejects(applySync(next), /blocked/);
  assert.equal(
    JSON.parse(await fs.readFile(f.file('claude-code'), 'utf8')).mcpServers.demo.command,
    'locally-modified',
  );
  for (const id of ['codex', 'dsh'])
    assert.equal(await fs.readFile(f.file(id), 'utf8'), original[id]);
});

test('an explicit import choice can replace reviewed variants, while later edits still block sync', async (t) => {
  const f = await fixture(t);
  const previous = process.env.AGENT_HUB_HOME;
  process.env.AGENT_HUB_HOME = f.root;
  t.after(() => {
    if (previous === undefined) delete process.env.AGENT_HUB_HOME;
    else process.env.AGENT_HUB_HOME = previous;
  });
  const variants = {};
  for (const id of ['claude-code', 'codex']) {
    variants[id] = { command: 'fixture-mcp', args: [id], env: { API_TOKEN: secret } };
    await fs.writeFile(
      f.file(id),
      editDefinitions(
        id,
        await fs.readFile(f.file(id), 'utf8'),
        new Map([['choice', variants[id]]]),
      ),
    );
  }
  const sources = f.context.targets.map((target) => ({
    id: target.id,
    detect: async () => ({ installed: true, paths: {} }),
    async readMcpRaw() {
      return [...readDefinitions(target.id, await fs.readFile(target.file, 'utf8'))].map(
        ([name, raw]) => ({ name, raw, source: target.file }),
      );
    },
  }));
  const imported = await planImport('mcp:choice', { prefer: 'codex,claude-code' }, sources);
  await applyImport(imported);
  assert.equal((await planSync({}, f.context)).blocked, false);
  const fingerprints = await fs.readFile(
    path.join(f.root, 'state', 'imported-definitions.json'),
    'utf8',
  );
  assert.ok(!fingerprints.includes(secret));
  await fs.writeFile(
    f.file('claude-code'),
    editDefinitions(
      'claude-code',
      await fs.readFile(f.file('claude-code'), 'utf8'),
      new Map([['choice', { ...variants['claude-code'], args: ['new-local-edit'] }]]),
    ),
  );
  assert.equal((await planSync({}, f.context)).blocked, true);
  await fs.writeFile(
    f.file('claude-code'),
    editDefinitions(
      'claude-code',
      await fs.readFile(f.file('claude-code'), 'utf8'),
      new Map([['choice', variants['claude-code']]]),
    ),
  );
  await applySync(await planSync({}, f.context));
  for (const target of f.context.targets)
    assert.equal(
      readDefinitions(target.id, await fs.readFile(target.file, 'utf8')).get('choice').command,
      process.execPath,
    );
});

test('removes only previously owned entries when the hub removes a server', async (t) => {
  const f = await fixture(t);
  await applySync(await planSync({}, f.context));
  await fs.writeFile(path.join(f.root, 'mcp', 'servers.yaml'), 'version: 1\nservers: {}\n');
  const plan = await planSync({}, f.context);
  assert.equal(plan.blocked, false);
  assert.equal(plan.targets.flatMap((v) => v.rows).filter((r) => r.action === 'remove').length, 3);
  await applySync(plan);
  for (const c of f.context.targets) {
    const defs = readDefinitions(c.id, await fs.readFile(c.file, 'utf8'));
    assert.ok(!defs.has('demo'));
    assert.ok(defs.has('unrelated'));
  }
});

test('honors client scope, disabled clients and app-owned servers', async (t) => {
  const f = await fixture(t);
  await fs.writeFile(
    path.join(f.root, 'hub.yaml'),
    'version: 1\nclients:\n  claude-code:\n    enabled: false\n',
  );
  const reg = parse(await fs.readFile(path.join(f.root, 'mcp', 'servers.yaml'), 'utf8'));
  reg.servers.demo.only = ['codex'];
  reg.servers.node_repl = {
    command: '/Applications/ChatGPT.app/Contents/Resources/node_repl',
    only: ['codex'],
  };
  await fs.writeFile(path.join(f.root, 'mcp', 'servers.yaml'), stringify(reg));
  const plan = await planSync({}, f.context);
  assert.equal(plan.blocked, false);
  assert.equal(publicSyncPlan(plan).files.filter((v) => v.changed).length, 1);
  assert.equal((await applySync(plan)).changedFiles, 1);
  assert.equal(await fs.readFile(f.file('claude-code'), 'utf8'), original['claude-code']);
  assert.equal(await fs.readFile(f.file('dsh'), 'utf8'), original.dsh);
});

test('invalid or unsupported configs are blocked without echoing their values', async (t) => {
  const f = await fixture(t);
  await fs.writeFile(f.file('claude-code'), `{ invalid ${secret}`);
  const plan = await planSync({}, f.context);
  assert.equal(plan.blocked, true);
  assert.ok(!JSON.stringify(publicSyncPlan(plan)).includes(secret));
  const inline =
    'mcp_servers = { demo = { command = "fixture-mcp", args = ["serve"], env = { API_TOKEN = "' +
    secret +
    '" } } }\n';
  assert.throws(
    () => editDefinitions('codex', inline, new Map([['demo', { command: 'node' }]])),
    /explicit/,
  );
  await assert.rejects(applySync(plan), /blocked/);
});

test('quoted TOML server names and table-looking multiline strings are edited correctly', () => {
  const source = `notes = '''\n[mcp_servers.fake]\n'''\n\n[mcp_servers."dotted.name"]\ncommand = "old"\n[mcp_servers."dotted.name".tools.test]\napproval_mode = "prompt"\n\n[other]\nvalue = "unchanged"\n`;
  const edited = editDefinitions('codex', source, new Map([['dotted.name', { command: 'new' }]]));
  const result = parseToml(edited);
  assert.equal(result.notes, parseToml(source).notes);
  assert.equal(result.mcp_servers['dotted.name'].command, 'new');
  assert.equal(result.other.value, 'unchanged');
  assert.ok(edited.includes('[other]\nvalue = "unchanged"'));
  const fourQuotes = `notes = '''\nkeep a trailing quote\n''''\n\n[mcp_servers.demo]\ncommand = "old"\n`;
  const fixed = editDefinitions('codex', fourQuotes, new Map([['demo', { command: 'new' }]]));
  assert.equal(parseToml(fixed).mcp_servers.demo.command, 'new');
  assert.equal(parseToml(fixed).notes, parseToml(fourQuotes).notes);
});

test('preserves config symlinks and can restore a newly created config', async (t) => {
  const f = await fixture(t);
  const real = path.join(f.root, 'dotfiles.toml');
  await fs.rename(f.file('codex'), real);
  await fs.symlink(real, f.file('codex'));
  await fs.unlink(f.file('claude-code'));
  const result = await applySync(await planSync({}, f.context));
  assert.equal((await fs.lstat(f.file('codex'))).isSymbolicLink(), true);
  await applyRestore(await planRestore(result.backup, f.context));
  assert.equal((await fs.lstat(f.file('codex'))).isSymbolicLink(), true);
  assert.equal(await fs.readFile(real, 'utf8'), original.codex);
  await assert.rejects(fs.access(f.file('claude-code')));
});

test('restore refuses to overwrite edits made after sync', async (t) => {
  const f = await fixture(t);
  const result = await applySync(await planSync({}, f.context));
  await fs.appendFile(f.file('codex'), '\n# local edit after sync\n');
  const plan = await planRestore(result.backup, f.context);
  assert.equal(plan.blocked, true);
  await assert.rejects(applyRestore(plan), /blocked/);
  assert.ok((await fs.readFile(f.file('codex'), 'utf8')).endsWith('# local edit after sync\n'));
});

test('rolls back already-written clients if a later client cannot be written', async (t) => {
  const f = await fixture(t);
  const parent = path.dirname(f.file('claude-code'));
  await fs.chmod(parent, 0o500);
  await assert.rejects(applySync(await planSync({}, f.context)), /rolled back/);
  for (const c of f.context.targets)
    assert.equal(await fs.readFile(c.file, 'utf8'), original[c.id]);
  await assert.rejects(fs.access(path.join(f.root, 'state', 'sync.json')));
  await assert.rejects(fs.access(path.join(f.root, 'state', 'sync.lock')));
});

test('CLI defaults to dry run, prints a runnable command, and rejects ambiguous flags', async (t) => {
  const f = await fixture(t);
  const env = { ...process.env, AGENT_HUB_HOME: f.root, DSH_HOME: path.join(f.root, 'dsh') };
  const result = JSON.parse(
    execFileSync(process.execPath, [cli, 'sync', '--client', 'dsh', '--json'], {
      env,
      encoding: 'utf8',
    }),
  );
  assert.equal(result.dryRun, true);
  assert.equal(result.files.length, 1);
  assert.match(result.commands.apply, /--expect/);
  assert.equal(await fs.readFile(f.file('dsh'), 'utf8'), original.dsh);
  assert.throws(() =>
    execFileSync(process.execPath, [cli, 'sync', '--apply', '--dry-run'], { env, stdio: 'pipe' }),
  );
});

test('HTTP sync preview is read-only, apply consumes it, and stale previews are rejected', async (t) => {
  const f = await fixture(t);
  const ui = await startUiServer({
    port: 0,
    services: { state: async () => ({}), syncPlan: (opts) => planSync(opts, f.context) },
  });
  t.after(() => ui.close());
  const token = (await (await fetch(`${ui.url}/api/state`)).json()).token;
  const post = (route, body, useToken = true) =>
    fetch(`${ui.url}/api/sync/${route}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Agent-Hub-Token': useToken ? token : '' },
      body: JSON.stringify(body),
    });
  assert.equal((await post('preview', {}, false)).status, 403);
  assert.equal((await post('preview', { client: 'invalid' })).status, 400);
  const preview = await (await post('preview', {})).json();
  assert.equal(preview.blocked, false);
  assert.ok(!JSON.stringify(preview).includes(secret));
  assert.equal(await fs.readFile(f.file('codex'), 'utf8'), original.codex);
  const applied = await post('apply', { id: preview.id });
  assert.equal(applied.status, 200);
  assert.equal((await applied.json()).changedFiles, 3);
  assert.equal((await post('apply', { id: preview.id })).status, 409);
  const next = await (await post('preview', {})).json();
  await fs.appendFile(f.file('codex'), '\n# modified\n');
  assert.equal((await post('apply', { id: next.id })).status, 409);
});

test('explicit replacement is client-scoped and retains unselected conflicts and safety checks', async (t) => {
  const f = await fixture(t);
  await assert.rejects(planSync({ replace: ['demo'] }, f.context), /one --client/);
  await assert.rejects(
    planSync({ client: 'dsh', replace: ['missing'] }, f.context),
    /not in the hub/,
  );
  await assert.rejects(planSync({ client: 'dsh', replace: [] }, f.context), /valid server names/);
  const raw = await fs.readFile(f.file('dsh'), 'utf8');
  await fs.writeFile(
    f.file('dsh'),
    editDefinitions(
      'dsh',
      raw,
      new Map([['demo', { serverName: 'demo', command: 'old-wrapper', args: ['serve'] }]]),
    ),
  );
  assert.equal((await planSync({ client: 'dsh' }, f.context)).blocked, true);
  const plan = await planSync({ client: 'dsh', replace: ['demo'] }, f.context);
  assert.equal(plan.blocked, false);
  assert.equal(plan.targets.length, 1);
  assert.equal(plan.targets[0].rows.find((row) => row.name === 'demo').action, 'replace');
  assert.match(plan.targets[0].rows.find((row) => row.name === 'demo').note, /Explicitly selected/);
  assert.match(publicSyncPlan(plan).commands.apply, /--replace.*demo.*--expect/);
  await fs.writeFile(
    f.file('dsh'),
    editDefinitions(
      'dsh',
      raw,
      new Map([['demo', { serverName: 'demo', command: 'old-wrapper', unsupportedSetting: true }]]),
    ),
  );
  assert.equal((await planSync({ client: 'dsh', replace: ['demo'] }, f.context)).blocked, true);
  const reg = parse(await fs.readFile(path.join(f.root, 'mcp/servers.yaml'), 'utf8'));
  reg.servers.other = { command: 'hub-other' };
  await fs.writeFile(path.join(f.root, 'mcp/servers.yaml'), stringify(reg));
  await fs.writeFile(
    f.file('dsh'),
    editDefinitions(
      'dsh',
      raw,
      new Map([
        ['demo', { serverName: 'demo', command: 'old-wrapper' }],
        ['other', { serverName: 'other', command: 'client-other' }],
      ]),
    ),
  );
  const selected = await planSync({ client: 'dsh', replace: ['demo'] }, f.context);
  assert.equal(selected.blocked, true);
  assert.equal(selected.targets[0].rows.find((row) => row.name === 'other').action, 'conflict');
  assert.equal(
    (await planSync({ client: 'dsh', replace: ['demo', 'other'] }, f.context)).blocked,
    false,
  );
});

test('reviewed replacements reject absent approval and stale files, then write only the selected client with a restorable backup', async (t) => {
  const f = await fixture(t);
  const before = await fs.readFile(f.file('dsh'), 'utf8');
  const legacy = editDefinitions(
    'dsh',
    before,
    new Map([['demo', { serverName: 'demo', command: 'old-wrapper', args: ['serve'] }]]),
  );
  await fs.writeFile(f.file('dsh'), legacy);
  const plan = await planSync({ client: 'dsh', replace: ['demo'] }, f.context);
  await assert.rejects(applySync(plan), /requires --expect/);
  assert.equal(await fs.readFile(f.file('dsh'), 'utf8'), legacy);
  await fs.appendFile(f.file('dsh'), '\n# external edit\n');
  await assert.rejects(applySync(plan, plan.revision), /changed/);
  const fresh = await planSync({ client: 'dsh', replace: ['demo'] }, f.context);
  const result = await applySync(fresh, fresh.revision);
  assert.equal(result.changedFiles, 1);
  assert.equal(await fs.readFile(f.file('codex'), 'utf8'), original.codex);
  assert.equal(await fs.readFile(f.file('claude-code'), 'utf8'), original['claude-code']);
  const second = await planSync({ client: 'dsh' }, f.context);
  assert.equal(second.blocked, false);
  assert.ok(publicSyncPlan(second).files.every((file) => !file.changed));
  await applyRestore(await planRestore(result.backup, f.context));
  assert.equal(await fs.readFile(f.file('dsh'), 'utf8'), legacy + '\n# external edit\n');
});

test('CLI explicit replacement requires a reviewed revision and its copied apply command runs successfully', async (t) => {
  const f = await fixture(t);
  const raw = await fs.readFile(f.file('dsh'), 'utf8');
  const legacy = editDefinitions(
    'dsh',
    raw,
    new Map([['demo', { serverName: 'demo', command: 'old-wrapper' }]]),
  );
  await fs.writeFile(f.file('dsh'), legacy);
  const env = {
    ...process.env,
    AGENT_HUB_HOME: f.root,
    DSH_HOME: path.join(f.root, 'dsh'),
    CODEX_HOME: path.join(f.root, 'codex'),
    CLAUDE_CONFIG_DIR: path.join(f.root, 'claude'),
    AGENT_HUB_CLAUDE_CONFIG: f.file('claude-code'),
    AGENT_HUB_SHARED_SKILLS: path.join(f.root, 'skills'),
  };
  const args = [cli, 'sync', '--client', 'dsh', '--replace', 'demo'];
  const preview = JSON.parse(
    execFileSync(process.execPath, [...args, '--dry-run', '--json'], {
      env,
      encoding: 'utf8',
      stdio: 'pipe',
    }),
  );
  assert.equal(preview.blocked, false);
  assert.equal(await fs.readFile(f.file('dsh'), 'utf8'), legacy);
  assert.throws(() =>
    execFileSync(process.execPath, [...args, '--apply', '--json'], { env, stdio: 'pipe' }),
  );
  assert.equal(await fs.readFile(f.file('dsh'), 'utf8'), legacy);
  const result = JSON.parse(
    execFileSync('/bin/sh', ['-c', preview.commands.apply + ' --json'], {
      env,
      encoding: 'utf8',
      stdio: 'pipe',
    }),
  );
  assert.equal(result.result.changedFiles, 1);
});

test('copied replacement commands support server names beginning with a dash', async (t) => {
  const f = await fixture(t);
  const name = '--edge';
  const reg = parse(await fs.readFile(path.join(f.root, 'mcp/servers.yaml'), 'utf8'));
  reg.servers[name] = { command: 'desired-fixture' };
  await fs.writeFile(path.join(f.root, 'mcp/servers.yaml'), stringify(reg));
  await fs.writeFile(
    f.file('dsh'),
    editDefinitions(
      'dsh',
      original.dsh,
      new Map([[name, { serverName: name, command: 'previous-fixture' }]]),
    ),
  );
  const env = {
    ...process.env,
    AGENT_HUB_HOME: f.root,
    DSH_HOME: path.join(f.root, 'dsh'),
    CODEX_HOME: path.join(f.root, 'codex'),
    AGENT_HUB_CLAUDE_CONFIG: f.file('claude-code'),
    CLAUDE_CONFIG_DIR: path.join(f.root, 'claude'),
    AGENT_HUB_SHARED_SKILLS: path.join(f.root, 'skills'),
  };
  const preview = JSON.parse(
    execFileSync(
      process.execPath,
      [cli, 'sync', '--client', 'dsh', `--replace=${name}`, '--dry-run', '--json'],
      { env, encoding: 'utf8', stdio: 'pipe' },
    ),
  );
  assert.equal(preview.blocked, false);
  const applied = JSON.parse(
    execFileSync('/bin/sh', ['-c', preview.commands.apply + ' --json'], {
      env,
      encoding: 'utf8',
      stdio: 'pipe',
    }),
  );
  assert.equal(applied.result.changedFiles, 1);
});

test('client configs resolving to the same physical file are blocked during preview', async (t) => {
  const f = await fixture(t);
  const context = {
    ...f.context,
    targets: f.context.targets.map((target) =>
      target.id === 'codex' ? { ...target, file: f.file('claude-code') } : target,
    ),
  };
  const plan = await planSync({}, context);
  assert.equal(plan.blocked, true);
  assert.match(
    publicSyncPlan(plan).files.find((file) => file.client === 'claude-code').problem,
    /same configuration file/,
  );
  await assert.rejects(applySync(plan), /blocked/);
  for (const target of f.context.targets)
    assert.equal(await fs.readFile(target.file, 'utf8'), original[target.id]);
});
