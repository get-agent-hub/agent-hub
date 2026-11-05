import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { stringify } from 'yaml';
import { editDefinitions, readDefinitions } from '../dist/core/mcp/config-edit.js';
import { collectCandidates } from '../dist/core/mcp/importer.js';
import { toMcpEntry } from '../dist/core/mcp/mcp.js';
import { applySync, isCurrentProjection, planSync } from '../dist/core/mcp/sync.js';
import { collectStatus } from '../dist/core/overview/status.js';
import { cliPath } from '../dist/shared/runtime.js';
import { mcpDetails } from '../dist/ui/mcp-details.js';
import { createMcpPage } from '../ui/app/pages/mcp.js';
import { mcpSetup } from '../ui/app/entities/mcp.js';

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ahub-connections-'));
  const hub = path.join(root, 'hub');
  const pkg = path.join(root, 'another-install');
  const cli = path.join(pkg, 'dist/cli.js');
  const node = path.join(root, 'runtime/node');
  const metadata = path.join(pkg, 'package.json');
  const previous = process.env.AGENT_HUB_HOME;
  process.env.AGENT_HUB_HOME = hub;
  t.after(async () => {
    if (previous === undefined) delete process.env.AGENT_HUB_HOME;
    else process.env.AGENT_HUB_HOME = previous;
    await fs.rm(root, { recursive: true, force: true });
  });
  await fs.mkdir(path.dirname(cli), { recursive: true });
  await fs.mkdir(path.dirname(node), { recursive: true });
  await fs.symlink(process.execPath, node);
  // Identity checks must read metadata, never execute this fixture.
  await fs.writeFile(cli, 'throw new Error("must never execute during discovery");');
  await fs.writeFile(
    metadata,
    JSON.stringify({
      name: 'agent-hub',
      bin: { ahub: 'dist/cli.js', 'agent-hub': 'dist/cli.js' },
    }),
  );
  await fs.mkdir(path.join(hub, 'mcp'), { recursive: true });
  await fs.writeFile(path.join(hub, 'hub.yaml'), 'version: 1\n');
  const server = { command: 'uvx', args: ['fixture-atlassian'], env: { TOKEN: '${TOKEN}' } };
  await fs.writeFile(path.join(hub, '.env'), 'TOKEN=fixture-credential\n');
  await fs.writeFile(
    path.join(hub, 'mcp/servers.yaml'),
    stringify({ version: 1, servers: { demo: server } }),
  );
  const raw = { command: node, args: [cli, 'mcp', 'run', 'demo'], env: { AGENT_HUB_HOME: hub } };
  const targets = ['claude-code', 'codex', 'dsh'].map((id) => ({
    id,
    label: id,
    file: path.join(root, id + '.conf'),
    installed: true,
  }));
  const originals = new Map();
  for (const target of targets) {
    const definition = {
      ...raw,
      ...(target.id === 'dsh' ? { serverName: 'demo', transport: 'stdio' } : {}),
      ...(target.id === 'codex'
        ? {
            enabled: false,
            tools: { write: { approval_mode: 'prompt' } },
          }
        : {}),
    };
    const text = editDefinitions(
      target.id,
      null,
      new Map([
        ['demo', definition],
        [
          'unrelated',
          {
            command: 'keep-me',
            ...(target.id === 'dsh' ? { serverName: 'unrelated', transport: 'stdio' } : {}),
          },
        ],
      ]),
    );
    await fs.writeFile(target.file, text);
    originals.set(target.id, text);
  }
  const sources = targets.map((target) => ({
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
        mcp: (await this.readMcpRaw()).map((row) => toMcpEntry(row.name, row.raw, row.source)),
      };
    },
  }));
  return {
    root,
    hub,
    pkg,
    cli,
    node,
    metadata,
    server,
    raw,
    targets,
    sources,
    originals,
    context: { root: hub, cli: cliPath, node: process.execPath, targets },
  };
}

test('another installed Hub/Node is one connection across all clients, without importing or rewriting it', async (t) => {
  const f = await fixture(t);
  const status = await collectStatus(f.sources);
  const row = status.mcp.find((item) => item.name === 'demo');
  assert.equal(row.variants, 1);
  assert.ok(
    !status.drift.some((item) => item.name === 'demo'),
    JSON.stringify({ row, drift: status.drift }),
  );
  const details = await mcpDetails('demo', f.sources);
  assert.deepEqual(details.differingFields, []);
  assert.ok(details.copies.every((copy) => copy.managed && copy.matchesHub));
  assert.ok(!JSON.stringify(details).includes('fixture-credential'));
  assert.ok(
    !collectCandidates(
      await Promise.all(
        f.sources.map(async (source) => ({ client: source.id, items: await source.readMcpRaw() })),
      ),
    ).has('demo'),
  );
  const state = { status, servers: [{ name: 'demo', config: f.server }] };
  assert.equal(mcpSetup(row, state).kind, 'matching');
  const page = createMcpPage({ api: async () => details, render() {} });
  page.view(state, '', new URLSearchParams({ name: 'demo' }));
  await new Promise(setImmediate);
  const html = page.view(state, '', new URLSearchParams({ name: 'demo' }));
  assert.match(html, /Already uses the Hub copy/);
  assert.ok(!html.includes('data-direction="import"'));
  assert.ok(!html.includes('data-mcp-deliver="demo"'));
  const plan = await planSync({}, f.context);
  assert.equal(plan.blocked, false);
  assert.ok(
    plan.targets.every((target) => target.rows.find((r) => r.name === 'demo').action === 'keep'),
  );
  assert.equal((await applySync(plan)).changedFiles, 0);
  for (const target of f.targets)
    assert.equal(await fs.readFile(target.file, 'utf8'), f.originals.get(target.id));
});

test('existing connections and client policies survive delivering another server', async (t) => {
  const f = await fixture(t);
  await fs.writeFile(
    path.join(f.hub, 'mcp/servers.yaml'),
    stringify({ version: 1, servers: { demo: f.server, another: { command: 'fixture-other' } } }),
  );
  const plan = await planSync({}, f.context);
  assert.equal(plan.blocked, false);
  assert.equal((await applySync(plan)).changedFiles, 3);
  for (const target of f.targets) {
    const before = readDefinitions(target.id, f.originals.get(target.id));
    const after = readDefinitions(target.id, await fs.readFile(target.file, 'utf8'));
    assert.deepEqual(after.get('demo'), before.get('demo'));
    assert.deepEqual(after.get('unrelated'), before.get('unrelated'));
    assert.ok(after.has('another'));
  }
});

test('different targets, overrides, unknown executables and missing installations require review', async (t) => {
  const f = await fixture(t);
  const differentHub = path.join(f.root, 'other-hub');
  await fs.mkdir(differentHub);
  for (const raw of [
    { ...f.raw, env: { AGENT_HUB_HOME: differentHub } },
    { ...f.raw, env: { AGENT_HUB_HOME: 'relative-hub' } },
    { ...f.raw, args: [f.cli, 'mcp', 'run', 'other'] },
    { ...f.raw, args: [...f.raw.args, '--extra'] },
    { ...f.raw, env: { ...f.raw.env, NODE_OPTIONS: '--extra' } },
    { ...f.raw, command: path.join(f.root, 'not-node') },
    { ...f.raw, args: [path.join(f.pkg, 'missing.js'), 'mcp', 'run', 'demo'] },
    { ...f.raw, type: 'http' },
    { ...f.raw, cwd: f.root },
    { ...f.raw, env_vars: ['EXTERNAL_OVERRIDE'] },
    { ...f.raw, headers: { Authorization: 'fixture' } },
  ])
    assert.equal(await isCurrentProjection(raw, 'demo', f.hub), false);
  await fs.writeFile(
    f.metadata,
    JSON.stringify({ name: 'unrelated', bin: { ahub: 'dist/cli.js', 'agent-hub': 'dist/cli.js' } }),
  );
  assert.equal(await isCurrentProjection(f.raw, 'demo', f.hub), false);
  const details = await mcpDetails('demo', f.sources);
  assert.ok(
    details.copies.slice(1).every((copy) => !copy.managed && copy.hubLauncher && !copy.matchesHub),
  );
  const state = {
    status: await collectStatus(f.sources),
    servers: [{ name: 'demo', config: f.server }],
  };
  const page = createMcpPage({ api: async () => details, render() {} });
  page.view(state, '', new URLSearchParams({ name: 'demo' }));
  await new Promise(setImmediate);
  const html = page.view(state, '', new URLSearchParams({ name: 'demo' }));
  assert.match(html, /Hub connection needs review/);
  assert.ok(!html.includes('data-direction="import"'));
  assert.ok(html.includes('data-mcp-deliver="demo"'));
  const plan = await planSync({}, f.context);
  assert.equal(plan.blocked, true);
});

test('physical Hub/package aliases agree; a missing installation after preview blocks all writes', async (t) => {
  const f = await fixture(t);
  const alias = path.join(f.root, 'hub-alias');
  const packageAlias = path.join(f.root, 'package-alias');
  await fs.symlink(f.hub, alias);
  await fs.symlink(f.pkg, packageAlias);
  assert.equal(
    await isCurrentProjection(
      {
        ...f.raw,
        args: [path.join(packageAlias, 'dist/cli.js'), 'mcp', 'run', 'demo'],
        env: { AGENT_HUB_HOME: alias },
      },
      'demo',
      f.hub,
    ),
    true,
  );
  await fs.writeFile(
    path.join(f.hub, 'mcp/servers.yaml'),
    stringify({ version: 1, servers: { demo: f.server, another: { command: 'fixture-other' } } }),
  );
  const plan = await planSync({}, f.context);
  assert.equal(plan.blocked, false);
  await fs.unlink(f.metadata);
  await assert.rejects(applySync(plan), /need review/);
  for (const target of f.targets)
    assert.equal(await fs.readFile(target.file, 'utf8'), f.originals.get(target.id));
});
