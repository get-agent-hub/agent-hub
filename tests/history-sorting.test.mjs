import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { ingestHistory } from '../dist/core/history/ingest.js';
import { listHistory } from '../dist/core/history/query.js';
import { readHistory, writeHistory } from '../dist/core/history/storage.js';
import { startUiServer } from '../dist/ui/server.js';
import { historyFixture } from './helpers/history.mjs';

async function fixture(t) {
  const f = await historyFixture(t);
  await fs.rm(f.file);
  const rows = [
    ['Old', '2026-11-01T12:00:00+03:00', f.project],
    ['Unknown', 'invalid-time', f.other],
    ['Middle', '2026-11-02T12:00:00+03:00', f.project],
    ['New', '2026-11-03T10:00:00+00:00', f.other],
  ];
  for (const [title, timestamp, cwd] of rows) {
    await fs.writeFile(
      path.join(path.dirname(f.file), title + '.jsonl'),
      f.encode([
        { type: 'custom-title', customTitle: title, sessionId: title, timestamp, cwd },
        {
          type: 'user',
          sessionId: title,
          message: { role: 'user', content: 'Synthetic sorting fixture' },
        },
      ]),
    );
  }
  await ingestHistory(f.root, [f.source]);
  const catalog = await readHistory(f.root);
  // Capture/enumeration order must not accidentally agree with the requested date order.
  catalog.chats.sort(
    (a, b) => rows.findIndex((r) => r[0] === a.title) - rows.findIndex((r) => r[0] === b.title),
  );
  await writeHistory(f.root, catalog);
  return f;
}

test('date sorting covers the entire matching archive before pagination, with unknown clocks last', async (t) => {
  const f = await fixture(t);
  await fs.rm(f.source.root, { recursive: true });
  const file = path.join(f.root, 'state/history/catalog.json');
  const before = await fs.readFile(file);
  const titles = (page) => page.chats.map((chat) => chat.title);
  assert.deepEqual(titles(await listHistory(f.root, { operator: true })), [
    'Old',
    'Unknown',
    'Middle',
    'New',
  ]);
  assert.deepEqual(titles(await listHistory(f.root, { operator: true }, { sort: 'newest' })), [
    'New',
    'Middle',
    'Old',
    'Unknown',
  ]);
  assert.deepEqual(titles(await listHistory(f.root, { operator: true }, { sort: 'oldest' })), [
    'Old',
    'Middle',
    'New',
    'Unknown',
  ]);
  for (const sort of ['newest', 'oldest']) {
    const combined = [];
    let offset = 0;
    do {
      const page = await listHistory(f.root, { operator: true }, { sort, offset, limit: 1 });
      assert.equal(page.total, 4);
      combined.push(...titles(page));
      offset = page.next;
    } while (offset !== null);
    assert.deepEqual(
      combined,
      sort === 'newest' ? ['New', 'Middle', 'Old', 'Unknown'] : ['Old', 'Middle', 'New', 'Unknown'],
    );
  }
  assert.deepEqual(await fs.readFile(file), before);
});

test('sorting retains filters and grants; tied dates keep a stable catalog order', async (t) => {
  const f = await fixture(t);
  const catalog = await readHistory(f.root);
  const project = catalog.chats.find((chat) => chat.title === 'Old').projects[0];
  catalog.grants.push({ id: 'project-only', projects: [project], sources: [f.source.id] });
  await writeHistory(f.root, catalog);
  const page = await listHistory(f.root, { grant: 'project-only' }, { sort: 'newest', limit: 1 });
  assert.equal(page.total, 2);
  assert.equal(page.chats[0].title, 'Middle');
  assert.equal(
    (await listHistory(f.root, { operator: true }, { sort: 'newest', client: 'codex' })).total,
    0,
  );
  assert.equal(
    (await listHistory(f.root, { operator: true }, { sort: 'newest', project })).total,
    2,
  );
  assert.equal(
    (await listHistory(f.root, { operator: true }, { sort: 'oldest', query: 'New' })).chats[0]
      .title,
    'New',
  );
  await assert.rejects(listHistory(f.root, { operator: true }, { sort: 'unsupported' }), /sorting/);
  // Equal valid clocks must not reverse on direction changes or page boundaries.
  const time = '2026-11-04T09:00:00Z';
  await fs.writeFile(
    path.join(path.dirname(f.file), 'Tie A.jsonl'),
    f.encode([
      {
        type: 'custom-title',
        customTitle: 'Tie A',
        sessionId: 'tie-a',
        cwd: f.project,
        timestamp: time,
      },
    ]),
  );
  await fs.writeFile(
    path.join(path.dirname(f.file), 'Tie B.jsonl'),
    f.encode([
      {
        type: 'custom-title',
        customTitle: 'Tie B',
        sessionId: 'tie-b',
        cwd: f.project,
        timestamp: time,
      },
    ]),
  );
  await ingestHistory(f.root, [f.source]);
  const newest = await listHistory(f.root, { operator: true }, { sort: 'newest', query: 'Tie' });
  const oldest = await listHistory(f.root, { operator: true }, { sort: 'oldest', query: 'Tie' });
  assert.deepEqual(
    newest.chats.map((c) => c.id),
    oldest.chats.map((c) => c.id),
  );
});

test('the local HTTP API accepts only the two supported date directions', async (t) => {
  const f = await fixture(t);
  const previous = process.env.AGENT_HUB_HOME;
  process.env.AGENT_HUB_HOME = f.root;
  t.after(() => {
    if (previous === undefined) delete process.env.AGENT_HUB_HOME;
    else process.env.AGENT_HUB_HOME = previous;
  });
  const ui = await startUiServer({ port: 0, services: { state: async () => ({}) } });
  t.after(() => ui.close());
  const state = await (await fetch(ui.url + '/api/state')).json();
  const post = (sort) =>
    fetch(ui.url + '/api/history/list', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-agent-hub-token': state.token },
      body: JSON.stringify({ sort, limit: 1 }),
    });
  assert.equal((await post('invalid')).status, 400);
  assert.equal((await (await post('newest')).json()).chats[0].title, 'New');
  assert.equal((await (await post('oldest')).json()).chats[0].title, 'Old');
});
