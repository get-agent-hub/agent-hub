import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { startUiServer } from '../dist/ui/server.js';
import { displayServer, documentAt, skillDocument } from '../dist/ui/data.js';
import { planImport } from '../dist/core/import-plan.js';

const fixture = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-hub-ui-'));
const previousRoot = process.env.AGENT_HUB_HOME;
process.env.AGENT_HUB_HOME = path.join(fixture, 'hub');
const hub = process.env.AGENT_HUB_HOME;
const secret = 'fixture-super-private-credential';
const source = path.join(fixture, 'client.json');
const adapters = [
  {
    id: 'claude-code',
    detect: async () => ({ installed: true, paths: {} }),
    readMcpRaw: async () =>
      Object.entries(JSON.parse(await fs.readFile(source, 'utf8'))).map(([name, raw]) => ({
        name,
        raw,
        source,
      })),
  },
];
let ui;
let token;
const post = (route, body, headers = {}) =>
  fetch(`${ui.url}${route}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Agent-Hub-Token': token, ...headers },
    body: JSON.stringify(body),
  });

before(async () => {
  await fs.mkdir(path.join(hub, 'mcp'), { recursive: true });
  await fs.writeFile(path.join(hub, '.env'), '# fixture\n', { mode: 0o600 });
  await fs.writeFile(
    source,
    JSON.stringify({ demo: { command: 'node', args: ['demo.mjs'], env: { API_TOKEN: secret } } }),
  );
  ui = await startUiServer({
    port: 0,
    services: {
      quickPlan: async (options) => ({
        options,
        publicPlan: {
          revision: 'quick-fixture',
          blocked: false,
          workspace: options.workspace,
          steps: [],
          clients: options.clients ?? [],
        },
      }),
      quickApply: async () => ({ status: 'complete', steps: [] }),
      state: async () => ({ status: { hub: { root: hub, exists: true } } }),
      plan: (item, opts) => planImport(item, opts, adapters),
    },
  });
  token = (await (await fetch(`${ui.url}/api/state`)).json()).token;
});
after(async () => {
  await ui?.close();
  if (previousRoot === undefined) delete process.env.AGENT_HUB_HOME;
  else process.env.AGENT_HUB_HOME = previousRoot;
  await fs.rm(fixture, { recursive: true, force: true });
});

test('serves app assets with a restrictive policy and never exposes arbitrary files', async () => {
  for (const file of ['/', '/app.js', '/app.css', '/base.css']) {
    const res = await fetch(`${ui.url}${file}`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.match(res.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  }
  for (const file of ['/.env', '/src/cli.ts', '/api/unknown', '/mcp/servers.yaml'])
    assert.equal((await fetch(`${ui.url}${file}`)).status, 404);
});

test('rejects requests from other origins and mutations without the session token', async () => {
  assert.equal(
    (await fetch(`${ui.url}/api/state`, { headers: { Origin: 'https://example.com' } })).status,
    403,
  );
  const rebound = await new Promise((resolve, reject) => {
    http
      .get(`${ui.url}/api/state`, { headers: { Host: 'evil.example' } }, (res) => {
        res.resume();
        resolve(res.statusCode);
      })
      .on('error', reject);
  });
  assert.equal(rebound, 403);
  assert.equal((await post('/api/import/preview', {}, { 'X-Agent-Hub-Token': '' })).status, 403);
  assert.equal(
    (await post('/api/import/preview', {}, { Origin: 'https://example.com' })).status,
    403,
  );
  assert.equal(
    (await post('/api/import/preview', {}, { 'Sec-Fetch-Site': 'cross-site' })).status,
    403,
  );
});

test('validates input and bounds request size', async () => {
  assert.equal((await post('/api/import/preview', { item: 'skills' })).status, 400);
  assert.equal((await post('/api/import/preview', { prefer: 'unknown' })).status, 400);
  assert.equal((await post('/api/import/preview', { item: 'x'.repeat(18000) })).status, 413);
  assert.equal(
    (await post('/api/import/preview', {}, { 'Content-Type': 'text/plain' })).status,
    415,
  );
});

test('preview has no side effects or credential values; apply consumes the reviewed plan', async () => {
  const original = await fs.readFile(source, 'utf8');
  const response = await post('/api/import/preview', { item: 'mcp' });
  assert.equal(response.status, 200);
  const text = await response.text();
  assert.ok(!text.includes(secret));
  const preview = JSON.parse(text);
  assert.equal(preview.servers[0].action, 'add');
  assert.deepEqual(preview.envVarsToAdd, ['API_TOKEN']);
  await assert.rejects(fs.access(path.join(hub, 'mcp/servers.yaml')));
  assert.equal(await fs.readFile(path.join(hub, '.env'), 'utf8'), '# fixture\n');
  const applied = await post('/api/import/apply', { id: preview.id });
  assert.equal(applied.status, 200);
  assert.equal((await applied.json()).imported, 1);
  const registry = await fs.readFile(path.join(hub, 'mcp/servers.yaml'), 'utf8');
  assert.ok(registry.includes('${API_TOKEN}'));
  assert.ok(!registry.includes(secret));
  assert.ok((await fs.readFile(path.join(hub, '.env'), 'utf8')).includes(secret));
  assert.equal((await fs.stat(path.join(hub, '.env'))).mode & 0o777, 0o600);
  assert.equal(await fs.readFile(source, 'utf8'), original);
  assert.equal((await post('/api/import/apply', { id: preview.id })).status, 409);
});

test('rejects a stale preview after a client or hub secret changes', async () => {
  const preview = await (await post('/api/import/preview', { overwrite: true })).json();
  const beforeEnv = await fs.readFile(path.join(hub, '.env'), 'utf8');
  await fs.writeFile(
    source,
    JSON.stringify({ demo: { command: 'changed-command', env: { API_TOKEN: secret } } }),
  );
  assert.equal((await post('/api/import/apply', { id: preview.id })).status, 409);
  assert.equal(await fs.readFile(path.join(hub, '.env'), 'utf8'), beforeEnv);
  const next = await (await post('/api/import/preview', { overwrite: true })).json();
  await fs.appendFile(path.join(hub, '.env'), 'NEW_VAR=changed\n');
  assert.equal((await post('/api/import/apply', { id: next.id })).status, 409);
});

test('sanitizes MCP env, headers, flags and URL credentials while preserving references', () => {
  const config = displayServer('demo', {
    command: 'node',
    args: ['--api-key', secret, '--token=literal-token'],
    env: { API_KEY: secret, OTHER: 'unclassified-value', REF: '${KEEP_THIS}' },
    headers: { Authorization: `Bearer ${secret}`, 'X-Token': '${HEADER_TOKEN}' },
    url: `https://user:password@example.com/mcp?api_key=${secret}&other=private`,
  });
  const serialized = JSON.stringify(config);
  assert.ok(!serialized.includes(secret));
  assert.ok(!serialized.includes('literal-token'));
  assert.ok(!serialized.includes('unclassified-value'));
  assert.ok(!serialized.includes('user:password'));
  assert.ok(!serialized.includes('other=private'));
  assert.ok(serialized.includes('${KEEP_THIS}'));
  assert.ok(serialized.includes('${HEADER_TOKEN}'));
});

test('documents stay inside their known roots and skills are selected by registry name', async () => {
  const root = path.join(hub, 'skills', 'demo');
  await fs.mkdir(root, { recursive: true });
  await fs.writeFile(path.join(root, 'SKILL.md'), '# Demo\n<script>untrusted()</script>');
  const doc = await skillDocument('demo', 'hub');
  assert.match(doc.document.content, /# Demo/);
  assert.equal(await skillDocument('../../.env', 'hub'), null);
  await fs.symlink(path.join(hub, '.env'), path.join(root, 'escape.md'));
  assert.equal((await documentAt(root, 'escape.md')).content, null);
  assert.equal((await documentAt(root, '../../.env')).content, null);
});

test('source preference resolves conflicting client definitions consistently', async () => {
  const sources = ['claude-code', 'codex'].map((id) => ({
    id,
    detect: async () => ({ installed: true, paths: {} }),
    readMcpRaw: async () => [
      {
        name: 'conflicting',
        source: `${id}.json`,
        raw: { command: `${id}-command`, env: { API_TOKEN: `${id}-test-token` } },
      },
    ],
  }));
  const plan = await planImport('mcp:conflicting', { prefer: 'codex,claude-code' }, sources);
  assert.equal(plan.next.conflicting.command, 'codex-command');
  assert.match(plan.rows[0].note, /took codex/);
  assert.deepEqual(plan.rows[0].from, ['claude-code', 'codex']);
  assert.ok(!JSON.stringify(plan.next).includes('codex-test-token'));
});

test('serializes writes while an import is in progress', async () => {
  let entered;
  const started = new Promise((resolve) => (entered = resolve));
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  const isolated = await startUiServer({
    port: 0,
    services: {
      state: async () => ({}),
      plan: (item, opts) => planImport(item, opts, adapters),
      apply: async () => {
        entered();
        await gate;
        return { imported: 1, commit: undefined };
      },
    },
  });
  const localToken = (await (await fetch(`${isolated.url}/api/state`)).json()).token;
  const request = (route, body) =>
    fetch(`${isolated.url}${route}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Agent-Hub-Token': localToken },
      body: JSON.stringify(body),
    });
  try {
    const preview = await (await request('/api/import/preview', { overwrite: true })).json();
    const running = request('/api/import/apply', { id: preview.id });
    await started;
    assert.equal((await request('/api/import/apply', { id: preview.id })).status, 409);
    release();
    assert.equal((await running).status, 200);
  } finally {
    release();
    await isolated.close();
  }
});

test('parser errors do not echo client configuration or credentials', async () => {
  await fs.writeFile(source, `{ invalid JSON ${secret}`);
  const response = await post('/api/import/preview', {});
  assert.equal(response.status, 500);
  assert.ok(!(await response.text()).includes(secret));
});

test('quick UI previews stay bound to the startup workspace and apply once with a session token', async () => {
  assert.equal((await post('/api/quick/preview', {}, { 'X-Agent-Hub-Token': '' })).status, 403);
  assert.equal((await post('/api/quick/preview', { project: 'yes' })).status, 400);
  const response = await post('/api/quick/preview', {
    workspace: '/cannot-select-another-project',
    clients: ['codex'],
  });
  assert.equal(response.status, 200);
  const plan = await response.json();
  assert.notEqual(plan.workspace, '/cannot-select-another-project');
  const body = { previewId: plan.previewId, revision: plan.revision };
  assert.equal((await post('/api/quick/apply', body)).status, 200);
  assert.equal((await post('/api/quick/apply', body)).status, 409);
  assert.equal((await fetch(`${ui.url}/quick.js`)).status, 200);
});
