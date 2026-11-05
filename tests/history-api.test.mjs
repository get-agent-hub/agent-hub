import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createHistoryServer } from '../dist/mcp/history.js';
import { startUiServer } from '../dist/ui/server.js';
import { ingestHistory } from '../dist/core/history/ingest.js';
import { planHistoryPolicy, applyHistoryPolicy } from '../dist/core/history/policy.js';
import { readHistory } from '../dist/core/history/storage.js';
import { historyFixture } from './helpers/history.mjs';

test('HTTP history requires operator token, rejects path injection and preserves jobs across polling', async (t) => {
  const f = await historyFixture(t);
  const previous = process.env.AGENT_HUB_HOME;
  process.env.AGENT_HUB_HOME = f.root;
  t.after(() => {
    if (previous === undefined) delete process.env.AGENT_HUB_HOME;
    else process.env.AGENT_HUB_HOME = previous;
  });
  const ui = await startUiServer({
    port: 0,
    services: {
      state: async () => {
        throw new Error('unrelated config failure');
      },
      historySources: async () => [f.source],
    },
  });
  t.after(() => ui.close());
  const state = await (await fetch(ui.url + '/api/state')).json();
  const post = (route, body = {}, token = state.token, origin) =>
    fetch(ui.url + '/api/history/' + route, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Agent-Hub-Token': token,
        ...(origin ? { Origin: origin } : {}),
      },
      body: JSON.stringify(body),
    });
  assert.equal((await fetch(ui.url + '/api/history/status')).status, 405);
  assert.equal((await post('list', {}, '')).status, 403);
  assert.equal((await post('list', {}, state.token, 'https://example.invalid')).status, 403);
  assert.equal((await post('scan', { sources: [f.source.id], root: '/etc' })).status, 400);
  assert.equal((await post('scan', { sources: ['unknown'] })).status, 400);
  assert.equal((await post('read', { id: '../../etc/passwd' })).status, 409);
  const initial = await (await post('status')).json();
  assert.equal(initial.chats, 0);
  assert.equal(initial.sources.length, 1);
  await assert.rejects(fs.stat(path.join(f.root, 'state', 'history', 'catalog.json')), {
    code: 'ENOENT',
  });
  assert.equal((await post('scan', { sources: [f.source.id] })).status, 202);
  for (let i = 0; i < 100; i++) {
    const job = await (await post('job')).json();
    if (job.state !== 'running') {
      assert.equal(job.state, 'complete');
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  const list = await (await post('list')).json();
  assert.equal(list.total, 1);
  const chat = list.chats[0];
  const read = await (await post('read', { id: chat.id, limit: 2 })).json();
  assert.equal(read.events.length, 2);
  assert.equal(read.next, 2);
  assert.equal((await (await post('search', { query: 'End sentinel' })).json()).total, 1);
  assert.match(
    (await (await post('event', { id: chat.id, ordinal: 3 })).json()).text,
    /retained extension/,
  );
  const policy = await (
    await post('policy/preview', { operation: 'exclude', id: chat.projects[0], excluded: true })
  ).json();
  assert.equal(
    (await post('policy/apply', { change: policy.change, revision: 'stale' })).status,
    409,
  );
  assert.equal(
    (await post('policy/apply', { change: policy.change, revision: policy.revision })).status,
    200,
  );
  assert.equal((await (await post('list')).json()).total, 0);
  const scripts = await fetch(ui.url + '/features/history.js');
  assert.equal(scripts.status, 200);
  assert.match(await scripts.text(), /Capture selected history/);
});

test('MCP exposes complete windowed history only through the current persisted grant and handles revocation', async (t) => {
  const f = await historyFixture(t);
  const catalog = await ingestHistory(f.root, [f.source]);
  const chat = catalog.chats[0];
  async function policy(change) {
    const plan = await planHistoryPolicy(f.root, change);
    await applyHistoryPolicy(f.root, change, plan.revision);
  }
  await policy({
    operation: 'grant',
    id: 'native-client',
    projects: chat.projects,
    sources: [f.source.id],
  });
  const server = createHistoryServer(f.root, 'native-client');
  const client = new Client({ name: 'history-fixture', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  await client.connect(b);
  t.after(async () => {
    await client.close();
    await server.close();
  });
  assert.deepEqual(
    (await client.listTools()).tools.map((tool) => tool.name),
    ['history_list', 'history_search', 'history_read', 'history_event'],
  );
  const list = await client.callTool({ name: 'history_list', arguments: {} });
  assert.equal(JSON.parse(list.content[0].text).total, 1);
  const search = await client.callTool({
    name: 'history_search',
    arguments: { query: 'End sentinel' },
  });
  assert.equal(JSON.parse(search.content[0].text).total, 1);
  const read = await client.callTool({
    name: 'history_read',
    arguments: { id: chat.id, offset: 0, limit: 2 },
  });
  assert.equal(JSON.parse(read.content[0].text).next, 2);
  const event = await client.callTool({
    name: 'history_event',
    arguments: { id: chat.id, ordinal: 3 },
  });
  assert.match(JSON.parse(event.content[0].text).text, /retained extension/);
  await policy({ operation: 'revoke', id: 'native-client' });
  const denied = await client.callTool({ name: 'history_read', arguments: { id: chat.id } });
  assert.equal(denied.isError, true);
  assert.match(denied.content[0].text, /revoked/);
  assert.equal((await readHistory(f.root)).chats.length, 1);
});
