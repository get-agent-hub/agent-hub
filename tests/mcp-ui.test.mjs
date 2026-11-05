import { createMcpPage } from '../ui/app/pages/mcp.js';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { stringify } from 'yaml';
import { mcpDetails } from '../dist/ui/mcp-details.js';
import { startUiServer } from '../dist/ui/server.js';
import { cliPath } from '../dist/shared/runtime.js';
import { mcpSetup } from '../ui/app/entities/mcp.js';

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ahub-mcp-ui-'));
  const previous = process.env.AGENT_HUB_HOME;
  process.env.AGENT_HUB_HOME = root;
  t.after(async () => {
    if (previous === undefined) delete process.env.AGENT_HUB_HOME;
    else process.env.AGENT_HUB_HOME = previous;
    await fs.rm(root, { recursive: true, force: true });
  });
  await fs.mkdir(path.join(root, 'mcp'));
  const privateA = 'fixture-private-source-value';
  const privateB = 'fixture-private-other-value';
  await fs.writeFile(path.join(root, '.env'), `TOKEN=${privateA}\n`);
  await fs.writeFile(
    path.join(root, 'mcp/servers.yaml'),
    stringify({
      version: 1,
      servers: {
        demo: {
          command: 'node',
          args: ['tool.mjs', '--token', '${TOKEN}'],
          env: { AUTH_TOKEN: '${TOKEN}' },
        },
      },
    }),
  );
  const native = {
    command: 'node',
    args: ['tool.mjs', '--token', privateA],
    env: { AUTH_TOKEN: privateA },
    oauth: 'never-serialize-client-fields',
  };
  const sources = ['claude-code', 'codex'].map((id) => ({
    id,
    label: id === 'codex' ? 'Codex' : 'Claude Code',
    detect: async () => ({ installed: true, paths: {} }),
    readMcpRaw: async () => [
      {
        name: 'demo',
        raw: {
          ...native,
          ...(id === 'codex'
            ? { enabled: false, tools: { write: { approval_mode: 'prompt' } } }
            : {}),
        },
        source: path.join(root, id + '.json'),
      },
    ],
  }));
  return { root, privateA, privateB, native, sources };
}

test('comparison uses effective settings and hides credentials, raw client fields and fingerprints', async (t) => {
  const f = await fixture(t);
  f.sources[1].readMcpRaw = async () => [
    {
      name: 'demo',
      raw: {
        ...f.native,
        args: ['tool.mjs', '--token', f.privateB],
        env: { AUTH_TOKEN: f.privateB },
        headers: { Authorization: 'Bearer ' + f.privateB },
        url: 'https://user:password@example.test/mcp?key=private-query',
      },
      source: path.join(f.root, 'codex.json'),
    },
  ];
  const before = await fs.readFile(path.join(f.root, 'mcp/servers.yaml'));
  const result = await mcpDetails('demo', f.sources);
  assert.equal(result.copies[1].matchesHub, true);
  assert.equal(result.copies[2].matchesHub, false);
  assert.ok(result.differingFields.includes('env'));
  assert.ok(result.copies[2].differences.includes('args'));
  const json = JSON.stringify(result);
  for (const value of [
    f.privateA,
    f.privateB,
    'never-serialize-client-fields',
    'user:password',
    'private-query',
  ])
    assert.ok(!json.includes(value));
  assert.ok(!json.includes('fingerprint'));
  assert.deepEqual(await fs.readFile(path.join(f.root, 'mcp/servers.yaml')), before);
});

test('matching copies preserve client-only policies and Hub launchers are compared as their Hub definition', async (t) => {
  const f = await fixture(t);
  let result = await mcpDetails('demo', f.sources);
  assert.equal(result.copies[2].matchesHub, true);
  assert.deepEqual(result.differingFields, []);
  f.sources[0].readMcpRaw = async () => [
    {
      name: 'demo',
      raw: {
        command: process.execPath,
        args: [cliPath, 'mcp', 'run', 'demo'],
        env: { AGENT_HUB_HOME: f.root },
      },
      source: 'fixture-config',
    },
  ];
  result = await mcpDetails('demo', f.sources);
  assert.equal(result.copies[1].managed, true);
  assert.equal(result.copies[1].matchesHub, true);
  assert.equal(result.copies[1].config.command, 'node');
});

test('duplicate source entries remain explicit, and comparison accepts known names rather than arbitrary paths', async (t) => {
  const f = await fixture(t);
  f.sources[0].readMcpRaw = async () => [
    { name: 'demo', raw: f.native, source: 'first' },
    { name: 'demo', raw: { command: 'different' }, source: 'second' },
  ];
  const ui = await startUiServer({
    port: 0,
    cwd: f.root,
    services: { state: async () => ({}), mcp: (name) => mcpDetails(name, f.sources) },
  });
  t.after(() => ui.close());
  const response = await fetch(ui.url + '/api/mcp?name=demo');
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(
    data.copies.filter((copy) => copy.client === 'claude-code' && copy.ambiguous).length,
    2,
  );
  for (const name of ['../../.env', 'unknown', 'constructor', 'toString'])
    assert.equal((await fetch(ui.url + '/api/mcp?' + new URLSearchParams({ name }))).status, 404);
  assert.equal(
    (await fetch(ui.url + '/api/mcp?name=demo', { headers: { Origin: 'https://example.test' } }))
      .status,
    403,
  );
});

test('setup labels distinguish choosing settings, collecting and connecting without claiming a network failure', () => {
  const clients = [
    { id: 'claude-code', installed: true },
    { id: 'codex', installed: true },
  ];
  const state = { servers: [], status: { clients }, quickClients: ['claude-code', 'codex'] };
  assert.equal(
    mcpSetup({ name: 'demo', cells: { hub: null, 'claude-code': 'A', codex: 'B' } }, state).kind,
    'choice',
  );
  assert.equal(
    mcpSetup({ name: 'demo', cells: { hub: null, 'claude-code': 'A', codex: 'A' } }, state).kind,
    'collect',
  );
  state.servers = [{ name: 'demo', config: { only: ['claude-code'] } }];
  assert.equal(
    mcpSetup({ name: 'demo', cells: { hub: 'A', 'claude-code': 'A', codex: 'B' } }, state).kind,
    'matching',
  );
  assert.equal(
    mcpSetup({ name: 'demo', cells: { hub: 'A', 'claude-code': null, codex: 'B' } }, state).kind,
    'connect',
  );
});

test('server decisions name the exact direction and keep JSON behind disclosures', async () => {
  const row = { name: 'demo', cells: { hub: 'A', codex: 'B' } };
  const state = {
    status: { mcp: [row], clients: [{ id: 'codex', label: 'Codex', installed: true }] },
    quickClients: ['codex'],
    servers: [{ name: 'demo', config: { command: 'example-program' } }],
  };
  const copies = [
    {
      client: 'hub',
      label: 'Hub',
      path: '/fixture/hub',
      managed: true,
      ambiguous: false,
      matchesHub: true,
      differences: [],
      config: {},
    },
    {
      client: 'codex',
      label: 'Codex',
      path: '/fixture/codex',
      managed: false,
      ambiguous: false,
      matchesHub: false,
      differences: ['args', 'env'],
      config: {},
    },
  ];
  const page = createMcpPage({ api: async () => ({ copies }), render: () => {} });
  page.view(state, '', new URLSearchParams({ name: 'demo' }));
  await new Promise(setImmediate);
  const html = page.view(state, '', new URLSearchParams({ name: 'demo' }));
  assert.match(html, /Use Hub settings in Codex/);
  assert.match(html, /Use Codex settings in Hub/);
  assert.match(html, /data-replace="true"/);
  assert.match(html, /data-name="demo"/);
  assert.match(html, /environment or credentials/);
  assert.ok(!/<details class="mcp-config"[^>]*\bopen\b/.test(html));
  assert.ok(!html.includes('Definition A'));
});

test('a selected server remains visible after setup and ambiguous sources cannot be chosen as a single copy', async () => {
  const row = { name: 'demo', cells: { hub: 'A', codex: 'A' } };
  const state = {
    status: { mcp: [row], clients: [{ id: 'codex', label: 'Codex', installed: true }] },
    quickClients: ['codex'],
    servers: [{ name: 'demo', config: { command: 'searchable-program' } }],
  };
  const page = createMcpPage({
    api: async () => ({
      copies: [
        {
          client: 'codex',
          label: 'Codex',
          path: '/fixture',
          managed: false,
          ambiguous: true,
          matchesHub: true,
          differences: [],
          config: {},
        },
      ],
    }),
    render: () => {},
  });
  const params = new URLSearchParams({ name: 'demo', filter: 'setup' });
  page.view(state, '', params);
  await new Promise(setImmediate);
  const html = page.view(state, '', params);
  assert.match(html, /Settings match/);
  assert.match(html, /Resolve the duplicate entries/);
  assert.ok(!html.includes('data-direction="import"'));
  assert.ok(!html.includes('data-mcp-deliver="demo"'));
  assert.match(
    page.view(state, 'searchable-program', new URLSearchParams()),
    /data-ui-key="mcp-copy/,
  );
});
