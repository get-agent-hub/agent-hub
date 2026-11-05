import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { ingestHistory } from '../dist/core/history/ingest.js';
import { historyOverview } from '../dist/core/history/overview.js';
import {
  listHistory,
  readConversation,
  readHistoryEvent,
  searchHistory,
  historyBytes,
} from '../dist/core/history/query.js';
import { applyHistoryPolicy, planHistoryPolicy } from '../dist/core/history/policy.js';
import { rebuildHistory } from '../dist/core/history/rebuild.js';
import { readHistory, revisionDirectory } from '../dist/core/history/storage.js';
import { historyFixture } from './helpers/history.mjs';

const operator = { operator: true };
async function policy(root, change) {
  const plan = await planHistoryPolicy(root, change);
  return applyHistoryPolicy(root, change, plan.revision);
}

test('full archive preserves every source byte, native event and unknown field without modifying native files', async (t) => {
  const fixture = await historyFixture(t);
  const { root, source, file } = fixture;
  const original = await fs.readFile(file);
  const catalog = await ingestHistory(root, [source]);
  assert.equal(catalog.chats.length, 1);
  const chat = catalog.chats[0];
  assert.equal(chat.events, 4);
  assert.equal(chat.content, 'complete');
  assert.equal(chat.title, 'A useful conversation title');
  assert.equal(catalog.projects.length, 1);
  const raw = await historyBytes(root, operator, chat.id);
  assert.deepEqual(Buffer.from(raw.data, 'base64'), original);
  assert.deepEqual(await fs.readFile(file), original);
  assert.equal((await readConversation(root, operator, chat.id)).events.length, 4);
  assert.match((await readHistoryEvent(root, operator, chat.id, 3)).text, /retained extension/);
  assert.equal((await searchHistory(root, operator, { query: 'Middle sentinel 🦊' })).total, 1);
  assert.equal((await searchHistory(root, operator, { query: 'End sentinel' })).total, 1);
  assert.equal((await searchHistory(root, operator, { query: 'not executed by Hub' })).total, 1);
  assert.equal((await ingestHistory(root, [source])).chats[0].revisions.length, 1);
  assert.equal((await readHistory(root)).receipts[0].changed, 0);
  assert.equal((await historyOverview(root, operator)).events, 4);
});

test('append, torn tail, same-size rewrite and source deletion preserve previous generations and stable project IDs', async (t) => {
  const { root, source, file, messages, encode } = await historyFixture(t);
  let catalog = await ingestHistory(root, [source]);
  const first = catalog.chats[0];
  await fs.appendFile(file, '{"type":"user","message":{"role":"user","content":"Pending');
  catalog = await ingestHistory(root, [source]);
  assert.equal(catalog.chats[0].content, 'pending-tail');
  assert.equal(catalog.chats[0].events, 4);
  await fs.appendFile(file, ' sentinel"}}\n');
  catalog = await ingestHistory(root, [source]);
  assert.equal(catalog.chats[0].content, 'complete');
  assert.equal(catalog.chats[0].events, 5);
  assert.equal((await searchHistory(root, operator, { query: 'Pending sentinel' })).total, 1);
  await fs.writeFile(file, encode(messages).replace('Middle sentinel', 'Edited sentinel'));
  catalog = await ingestHistory(root, [source]);
  assert.equal(catalog.chats[0].revisions.length, 4);
  assert.deepEqual(catalog.chats[0].projects, first.projects);
  assert.equal((await searchHistory(root, operator, { query: 'Edited sentinel' })).total, 1);
  assert.match(
    (await readHistoryEvent(root, operator, first.id, 1, 0, first.revision)).text,
    /Middle sentinel/,
  );
  await fs.rm(source.root, { recursive: true });
  catalog = await ingestHistory(root, [source]);
  assert.equal(catalog.receipts[0].coverage, 'not-found');
  assert.equal(catalog.chats.length, 1);
  assert.equal((await readConversation(root, operator, first.id)).events.length, 4);
});

test('large events are preserved, searchable through their end and readable in complete explicit windows', async (t) => {
  const { root, source, file, messages, encode } = await historyFixture(t);
  messages[0].message.content[0].text = 'large ' + 'x'.repeat(100000) + ' last-marker';
  await fs.writeFile(file, encode(messages));
  const chat = (await ingestHistory(root, [source])).chats[0];
  const view = await readConversation(root, operator, chat.id, { limit: 1 });
  assert.equal(view.events[0].textComplete, false);
  assert.equal(view.next, 1);
  assert.equal((await searchHistory(root, operator, { query: 'last-marker' })).total, 1);
  let offset = 0,
    text = '';
  do {
    const part = await readHistoryEvent(root, operator, chat.id, 0, offset);
    text += part.text;
    offset = part.next;
  } while (offset !== null);
  assert.deepEqual(JSON.parse(text), messages[0]);
});

test('grants protect list, search, direct events and bytes; revocation and exclusion apply immediately', async (t) => {
  const { root, source } = await historyFixture(t);
  const catalog = await ingestHistory(root, [source]);
  const chat = catalog.chats[0];
  await assert.rejects(listHistory(root, { grant: 'client-a' }), /not granted/);
  await policy(root, {
    operation: 'grant',
    id: 'client-a',
    projects: chat.projects,
    sources: [source.id],
  });
  assert.equal((await listHistory(root, { grant: 'client-a' })).total, 1);
  await policy(root, { operation: 'exclude', id: chat.projects[0], excluded: true });
  assert.equal((await listHistory(root, { grant: 'client-a' })).total, 0);
  assert.equal((await searchHistory(root, { grant: 'client-a' }, { query: 'sentinel' })).total, 0);
  await assert.rejects(readConversation(root, { grant: 'client-a' }, chat.id), /permitted scope/);
  await assert.rejects(historyBytes(root, { grant: 'client-a' }, chat.id), /permitted scope/);
  await policy(root, { operation: 'exclude', id: chat.projects[0], excluded: false });
  await policy(root, { operation: 'revoke', id: 'client-a' });
  await assert.rejects(readHistoryEvent(root, { grant: 'client-a' }, chat.id, 0), /revoked/);
});

test('reviewed deletion prevents reimport, while labels survive scans and stale policy revisions are rejected', async (t) => {
  const { root, source } = await historyFixture(t);
  const catalog = await ingestHistory(root, [source]);
  const chat = catalog.chats[0];
  const plan = await planHistoryPolicy(root, { operation: 'forget', id: chat.id });
  await policy(root, { operation: 'label', id: chat.projects[0], label: 'My project' });
  await assert.rejects(
    applyHistoryPolicy(root, plan.change, plan.revision),
    /changed since preview/,
  );
  await ingestHistory(root, [source]);
  assert.equal((await readHistory(root)).projects[0].label, 'My project');
  await policy(root, { operation: 'forget', id: chat.id });
  assert.equal((await ingestHistory(root, [source])).chats.length, 0);
  await assert.rejects(fs.stat(path.join(root, 'state', 'history', 'chats', chat.id)), {
    code: 'ENOENT',
  });
});

test('indexes rebuild from verified originals, while corrupt raw bytes and future catalogs are refused', async (t) => {
  const { root, source } = await historyFixture(t);
  const chat = (await ingestHistory(root, [source])).chats[0];
  const directory = await revisionDirectory(root, chat.id, chat.revision);
  await fs.writeFile(path.join(directory, 'events.json'), 'corrupt');
  await assert.rejects(readConversation(root, operator, chat.id), /index is unavailable/);
  assert.deepEqual(await rebuildHistory(root), { rebuilt: 1 });
  assert.equal((await readConversation(root, operator, chat.id)).events.length, 4);
  const raw = JSON.parse(await fs.readFile(path.join(directory, 'raw.json'), 'utf8'));
  await fs.appendFile(path.join(root, 'state', 'history', 'objects', raw.blocks[0].id), 'corrupt');
  await assert.rejects(rebuildHistory(root), /integrity/);
  const catalogFile = path.join(root, 'state', 'history', 'catalog.json');
  const catalog = JSON.parse(await fs.readFile(catalogFile, 'utf8'));
  catalog.version = 99;
  await fs.writeFile(catalogFile, JSON.stringify(catalog));
  await assert.rejects(ingestHistory(root, [source]), /newer format/);
  assert.equal(JSON.parse(await fs.readFile(catalogFile, 'utf8')).version, 99);
});
