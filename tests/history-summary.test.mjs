import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { ingestHistory } from '../dist/core/history/ingest.js';
import { historyChatSummary } from '../dist/core/history/summary.js';
import { historyEvents, listHistory } from '../dist/core/history/query.js';
import { readHistory, writeHistory } from '../dist/core/history/storage.js';
import { historyFixture } from './helpers/history.mjs';

async function fixture(t) {
  const f = await historyFixture(t);
  await ingestHistory(f.root, [f.source]);
  const catalog = await readHistory(f.root);
  const chat = catalog.chats[0];
  let reads = 0;
  const events = async function* () {
    reads++;
    yield* historyEvents(f.root, chat.id, chat.revision);
  };
  const index = path.join(f.root, 'state/history/chats', chat.id, chat.revision, 'events.json');
  return { ...f, chat, catalog, events, index, reads: () => reads };
}

test('simultaneous list projections share a prefix; live catalog fields are never cached', async (t) => {
  const f = await fixture(t);
  const file = path.join(f.root, 'state/history/catalog.json');
  const before = await fs.readFile(file);
  await fs.rm(f.source.root, { recursive: true });
  const read = (chat = f.chat) => historyChatSummary(f.root, chat, f.events);
  const rows = await Promise.all([read(), read(), read()]);
  assert.equal(f.reads(), 1);
  assert.equal(rows[0].title, f.chat.title);
  const current = { ...f.chat, projects: [], locations: [], issues: ['Current coverage warning'] };
  const result = await read(current);
  assert.deepEqual(result.projects, []);
  assert.deepEqual(result.locations, []);
  assert.deepEqual(result.issues, current.issues);
  assert.equal(f.reads(), 1);
  assert.deepEqual(await fs.readFile(file), before);
});

test('replaced indexes and changed catalog titles invalidate derived captions', async (t) => {
  const f = await fixture(t);
  await historyChatSummary(f.root, f.chat, f.events);
  await fs.writeFile(f.index + '.replacement', await fs.readFile(f.index));
  await fs.rename(f.index + '.replacement', f.index);
  await historyChatSummary(f.root, f.chat, f.events);
  assert.equal(f.reads(), 2);
  const renamed = { ...f.chat, title: 'A deliberately renamed conversation' };
  assert.equal((await historyChatSummary(f.root, renamed, f.events)).title, renamed.title);
  assert.equal(f.reads(), 3);
});

test('index failures remain visible and retry without retaining a failed projection', async (t) => {
  const f = await fixture(t);
  const failed = async function* () {
    yield await Promise.reject(new Error('Synthetic transient read failure'));
  };
  const unavailable = await historyChatSummary(f.root, f.chat, failed);
  assert.equal(unavailable.issues.length, f.chat.issues.length + 1);
  const healthy = await historyChatSummary(f.root, f.chat, f.events);
  assert.deepEqual(healthy.issues, f.chat.issues);
  assert.equal(f.reads(), 1);
  await fs.rename(f.index, f.index + '.saved');
  const missing = await historyChatSummary(f.root, f.chat, f.events);
  assert.equal(missing.issues.length, f.chat.issues.length + 1);
  await fs.rename(f.index + '.saved', f.index);
  assert.deepEqual((await historyChatSummary(f.root, f.chat, f.events)).issues, f.chat.issues);
});

test('warm lists still enforce changed access and observe newly captured revisions', async (t) => {
  const f = await fixture(t);
  const options = { sort: 'newest' };
  const original = (await listHistory(f.root, { operator: true }, options)).chats[0];
  f.catalog.grants.push({ id: 'reader', projects: [...f.chat.projects], sources: [f.source.id] });
  await writeHistory(f.root, f.catalog);
  assert.equal((await listHistory(f.root, { grant: 'reader' }, options)).total, 1);
  f.catalog.grants = [];
  await writeHistory(f.root, f.catalog);
  await assert.rejects(listHistory(f.root, { grant: 'reader' }, options));
  await fs.appendFile(
    f.file,
    f.encode([{ type: 'custom-title', sessionId: 'native-chat', customTitle: 'Updated task' }]),
  );
  await ingestHistory(f.root, [f.source]);
  const updated = (await listHistory(f.root, { operator: true }, options)).chats[0];
  assert.notEqual(updated.revision, original.revision);
  assert.equal(updated.title, 'Updated task');
});
