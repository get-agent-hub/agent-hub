import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { historySource } from '../dist/adapters/history/sources.js';
import { ingestHistory } from '../dist/core/history/ingest.js';
import {
  listHistory,
  readConversation,
  readHistoryEvent,
  searchHistory,
} from '../dist/core/history/query.js';
import { planHistoryPolicy, applyHistoryPolicy } from '../dist/core/history/policy.js';
import { readHistory, revisionDirectory } from '../dist/core/history/storage.js';
import { watchHistory } from '../dist/core/history/watch.js';
import { historyFixture } from './helpers/history.mjs';

const operator = { operator: true };

test('a different directory reusing an old project path cannot inherit its history grant', async (t) => {
  const f = await historyFixture(t);
  const catalog = await ingestHistory(f.root, [f.source]);
  const chat = catalog.chats[0];
  await policy(f.root, {
    operation: 'grant',
    id: 'old-project',
    projects: chat.projects,
    sources: [f.source.id],
  });
  await fs.rename(f.project, f.project + '-old');
  await fs.mkdir(f.project);
  await fs.appendFile(
    f.file,
    f.encode([
      {
        type: 'user',
        sessionId: 'native-chat',
        cwd: f.project,
        message: { role: 'user', content: 'new physical project' },
      },
    ]),
  );
  const updated = await ingestHistory(f.root, [f.source]);
  assert.equal(updated.chats[0].projects.length, 2);
  assert.equal((await listHistory(f.root, { grant: 'old-project' })).total, 0);
});
async function policy(root, change) {
  const plan = await planHistoryPolicy(root, change);
  return applyHistoryPolicy(root, change, plan.revision);
}

test('different projects and stores keep equal native IDs separate, and a multi-project chat needs every project grant', async (t) => {
  const f = await historyFixture(t);
  const second = path.join(path.dirname(f.file), 'other.jsonl');
  await fs.writeFile(
    second,
    f.encode([
      {
        type: 'user',
        sessionId: 'native-chat',
        cwd: f.other,
        message: { role: 'user', content: 'PRIVATE PROJECT B SENTINEL' },
      },
    ]),
  );
  let catalog = await ingestHistory(f.root, [f.source]);
  const a = catalog.chats.find((chat) => chat.relative.endsWith('native-chat.jsonl'));
  const b = catalog.chats.find((chat) => chat.relative.endsWith('other.jsonl'));
  await policy(f.root, {
    operation: 'grant',
    id: 'a-only',
    projects: a.projects,
    sources: [f.source.id],
  });
  assert.equal((await listHistory(f.root, { grant: 'a-only' })).total, 1);
  assert.equal(
    (await searchHistory(f.root, { grant: 'a-only' }, { query: 'PRIVATE PROJECT B' })).total,
    0,
  );
  await assert.rejects(readConversation(f.root, { grant: 'a-only' }, b.id), /permitted scope/);
  await fs.appendFile(f.file, f.encode([{ type: 'turn_context', payload: { cwd: f.other } }]));
  catalog = await ingestHistory(f.root, [f.source]);
  assert.equal(catalog.chats.find((chat) => chat.id === a.id).projects.length, 2);
  assert.equal((await listHistory(f.root, { grant: 'a-only' })).total, 0);
  await assert.rejects(
    readHistoryEvent(f.root, { grant: 'a-only' }, a.id, 0, 0, a.revision),
    /permitted scope/,
  );
  const cloned = historySource('claude-code', path.join(f.temporary, 'cloned-store'));
  await fs.mkdir(path.join(cloned.root, 'project'), { recursive: true });
  await fs.copyFile(f.file, path.join(cloned.root, 'project', 'native-chat.jsonl'));
  catalog = await ingestHistory(f.root, [cloned]);
  assert.equal(catalog.chats.length, 3);
});

test('old revision windows use their own event count after a shorter native rewrite', async (t) => {
  const f = await historyFixture(t);
  const old = (await ingestHistory(f.root, [f.source])).chats[0];
  await fs.writeFile(f.file, f.encode([f.messages[0]]));
  await ingestHistory(f.root, [f.source]);
  const first = await readConversation(f.root, operator, old.id, {
    revision: old.revision,
    limit: 2,
  });
  assert.equal(first.next, 2);
  assert.equal(first.chat.events, 4);
  const last = await readConversation(f.root, operator, old.id, {
    revision: old.revision,
    offset: first.next,
    limit: 2,
  });
  assert.equal(last.events.length, 2);
  assert.equal(last.next, null);
});

test('failed staging cannot acknowledge changed source data, and a retry retains the exact previously valid archive', async (t) => {
  const f = await historyFixture(t);
  const old = (await ingestHistory(f.root, [f.source])).chats[0];
  const staging = path.join(f.root, 'state', 'history', 'staging');
  await fs.rm(staging, { recursive: true });
  await fs.writeFile(staging, 'blocked storage');
  await fs.appendFile(
    f.file,
    f.encode([{ type: 'user', message: { role: 'user', content: 'new after storage failure' } }]),
  );
  let catalog = await ingestHistory(f.root, [f.source]);
  assert.equal(catalog.receipts[0].coverage, 'partial');
  assert.equal(catalog.chats[0].revision, old.revision);
  assert.equal((await readConversation(f.root, operator, old.id)).events.length, 4);
  await fs.unlink(staging);
  catalog = await ingestHistory(f.root, [f.source]);
  assert.equal(catalog.chats[0].events, 5);
});

test('archive symlink boundaries reject foreign descriptors and index reads without reading their targets', async (t) => {
  const f = await historyFixture(t);
  const chat = (await ingestHistory(f.root, [f.source])).chats[0];
  const directory = await revisionDirectory(f.root, chat.id, chat.revision);
  const descriptor = path.join(directory, 'events.json');
  await fs.unlink(descriptor);
  await fs.symlink(f.file, descriptor);
  await assert.rejects(
    readConversation(f.root, operator, chat.id),
    /index is unavailable|symbolic link/,
  );
  assert.equal((await readHistory(f.root)).chats[0].events, 4);
});

test('periodic history watcher validates its interval and stops cooperatively after a durable unit', async (t) => {
  const f = await historyFixture(t);
  await assert.rejects(watchHistory(f.root, { interval: 0 }), /5–300/);
  const controller = new AbortController();
  await assert.rejects(
    watchHistory(f.root, {
      sources: [f.source],
      interval: 5,
      signal: controller.signal,
      onProgress() {
        controller.abort();
      },
    }),
  );
  assert.equal((await readHistory(f.root)).chats.length, 1);
});

test('reused native path with another session identity cannot overwrite the older conversation', async (t) => {
  const f = await historyFixture(t);
  const first = (await ingestHistory(f.root, [f.source])).chats[0];
  await fs.writeFile(f.file, f.encode([{ ...f.messages[0], sessionId: 'replacement-chat' }]));
  let catalog = await ingestHistory(f.root, [f.source]);
  assert.equal(catalog.chats.length, 2);
  const replacement = catalog.chats.find((chat) => chat.nativeId === 'replacement-chat');
  await policy(f.root, { operation: 'forget', id: replacement.id });
  catalog = await ingestHistory(f.root, [f.source]);
  assert.equal(catalog.chats.length, 1);
  assert.equal(catalog.chats[0].id, first.id);
});

test('forgetting an old conversation does not suppress a genuinely new native session at its reused path', async (t) => {
  const f = await historyFixture(t);
  const original = (await ingestHistory(f.root, [f.source])).chats[0];
  await policy(f.root, { operation: 'forget', id: original.id });
  await fs.writeFile(
    f.file,
    f.encode([{ ...f.messages[0], sessionId: 'new-session-after-deletion' }]),
  );
  let catalog = await ingestHistory(f.root, [f.source]);
  assert.equal(catalog.chats.length, 1);
  assert.equal(catalog.chats[0].nativeId, 'new-session-after-deletion');
  assert.notEqual(catalog.chats[0].id, original.id);
  catalog = await ingestHistory(f.root, [f.source]);
  assert.equal(catalog.chats.length, 1);
});
