import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { historyEvent } from '../dist/adapters/history/events.js';
import { ingestHistory } from '../dist/core/history/ingest.js';
import {
  listHistory,
  readConversation,
  readHistoryEvent,
  searchHistory,
} from '../dist/core/history/query.js';
import { readHistory, writeHistory, revisionDirectory } from '../dist/core/history/storage.js';
import { rawWindow } from '../dist/core/history/raw.js';
import { historyFixture } from './helpers/history.mjs';
import { titledHistoryChat } from '../dist/core/history/presentation.js';

const operator = { operator: true };
const user = (text) => ({
  type: 'user',
  sessionId: 'native-chat',
  message: { role: 'user', content: text },
});
const notice =
  '<local-command-caveat>TERMINAL_NOTICE_SENTINEL: this output is recorded by the client.</local-command-caveat>';
function rows(cwd) {
  return [
    { ...user(notice), cwd },
    user('<command-name>/example</command-name><command-message>example</command-message>'),
    user('<local-command-stdout>TERMINAL_OUTPUT_SENTINEL</local-command-stdout>'),
    user('hi'),
    user('<pasted_content id="fixture">\nClarify cache invalidation\n</pasted_content>'),
    { type: 'assistant', message: { role: 'assistant', content: 'A normal answer' } },
  ];
}

test('new Claude titles skip local commands and greetings, clean pasted wrappers and preserve every original event', async (t) => {
  const f = await historyFixture(t);
  const messages = rows(f.project);
  const bytes = f.encode(messages);
  await fs.writeFile(f.file, bytes);
  const chat = (await ingestHistory(f.root, [f.source])).chats[0];
  assert.equal(chat.title, 'Clarify cache invalidation');
  const conversation = await readConversation(f.root, operator, chat.id, { view: 'conversation' });
  assert.deepEqual(
    conversation.events.map((event) => event.ordinal),
    [3, 4, 5],
  );
  assert.ok(conversation.events[1].text.includes('<pasted_content'));
  const all = await readConversation(f.root, operator, chat.id, { view: 'events' });
  assert.equal(all.events.length, messages.length);
  assert.equal(all.events[0].text, notice);
  assert.deepEqual(
    JSON.parse((await readHistoryEvent(f.root, operator, chat.id, 0)).text),
    messages[0],
  );
  assert.equal(
    (
      await searchHistory(f.root, operator, {
        query: 'TERMINAL_NOTICE_SENTINEL',
        view: 'conversation',
      })
    ).total,
    0,
  );
  assert.equal(
    (await searchHistory(f.root, operator, { query: 'TERMINAL_NOTICE_SENTINEL', view: 'events' }))
      .total,
    1,
  );
  const raw = await rawWindow(f.root, chat.id, chat.revision, 0);
  assert.equal(Buffer.from(raw.data, 'base64').toString(), bytes);
});

test('old catalog titles are repaired from preserved events without source access, rewriting the catalog or losing revision access', async (t) => {
  const f = await historyFixture(t);
  await fs.writeFile(f.file, f.encode(rows(f.project)));
  const chat = (await ingestHistory(f.root, [f.source])).chats[0];
  await fs.rm(f.source.root, { recursive: true });
  const catalogFile = path.join(f.root, 'state/history/catalog.json');
  for (const title of [
    notice.slice(0, 160),
    'hi',
    `Conversation ${chat.nativeId}`,
    '<pasted_content id="fixture">Old copied context',
  ]) {
    const catalog = await readHistory(f.root);
    catalog.chats[0].title = title;
    await writeHistory(f.root, catalog);
    const before = await fs.readFile(catalogFile);
    const listed = (await listHistory(f.root, operator)).chats[0];
    assert.equal(listed.title, 'Clarify cache invalidation');
    assert.equal(listed.revision, chat.revision);
    const opened = await readConversation(f.root, operator, chat.id, {
      revision: chat.revision,
      view: 'conversation',
    });
    assert.equal(opened.chat.title, listed.title);
    assert.deepEqual(await fs.readFile(catalogFile), before);
  }
});

test('explicit native titles win, even when a chosen name looks like a greeting', async (t) => {
  const f = await historyFixture(t);
  await fs.writeFile(
    f.file,
    f.encode([
      { type: 'custom-title', customTitle: 'hi', sessionId: 'native-chat', cwd: f.project },
      ...rows(f.project),
    ]),
  );
  const chat = (await ingestHistory(f.root, [f.source])).chats[0];
  assert.equal(chat.title, 'hi');
  assert.equal((await listHistory(f.root, operator)).chats[0].title, 'hi');
});

test('only known leading Claude command envelopes are technical; quoted markup and assistant explanations stay readable', () => {
  for (const text of [
    'Explain <local-command-caveat>example</local-command-caveat>',
    '```xml\n<local-command-caveat>example</local-command-caveat>\n```',
    '<custom_document>Keep this user text</custom_document>',
    notice + '\nExplain this notice and fix the command.',
    '<local-command-caveat>An incomplete literal example',
  ])
    assert.equal(historyEvent(user(text), 0).category, 'message');
  assert.equal(
    historyEvent({ type: 'assistant', message: { role: 'assistant', content: notice } }, 0)
      .category,
    'message',
  );
});

test('inline pasted wrappers keep the actual request, and command-only archives retain an honest fallback', async (t) => {
  const f = await historyFixture(t);
  await fs.writeFile(
    f.file,
    f.encode([
      {
        ...user('Review this failure <pasted_content id="fixture">safe details</pasted_content>'),
        cwd: f.project,
      },
    ]),
  );
  assert.equal(
    (await ingestHistory(f.root, [f.source])).chats[0].title,
    'Review this failure safe details',
  );
  await fs.writeFile(f.file, f.encode([{ ...user(notice), cwd: f.project }, user('привет!')]));
  const chat = (await ingestHistory(f.root, [f.source])).chats[0];
  // Simulate a catalog captured by the old first-message rule.
  const catalog = await readHistory(f.root);
  catalog.chats[0].title = notice.slice(0, 160);
  await writeHistory(f.root, catalog);
  assert.equal(
    (await listHistory(f.root, operator)).chats[0].title,
    `Conversation ${chat.nativeId}`,
  );
  assert.equal(
    (await readConversation(f.root, operator, chat.id, { view: 'events' })).events.length,
    2,
  );
});

test('an unavailable derived title cannot break the chat list or suppress cancellation', async (t) => {
  const f = await historyFixture(t);
  await fs.writeFile(f.file, f.encode(rows(f.project)));
  const chat = (await ingestHistory(f.root, [f.source])).chats[0];
  const catalog = await readHistory(f.root);
  catalog.chats[0].title = notice.slice(0, 160);
  await writeHistory(f.root, catalog);
  const directory = await revisionDirectory(f.root, chat.id, chat.revision);
  await fs.rm(path.join(directory, 'events.json'));
  const before = await fs.readFile(path.join(f.root, 'state/history/catalog.json'));
  const result = (await listHistory(f.root, operator)).chats[0];
  assert.equal(result.id, chat.id);
  assert.equal(result.title, `Conversation ${chat.nativeId}`);
  assert.ok(result.issues.some((issue) => issue.includes('title could not be fully checked')));
  assert.deepEqual(await fs.readFile(path.join(f.root, 'state/history/catalog.json')), before);
  await assert.rejects(readConversation(f.root, operator, chat.id), /index is unavailable/);
  const controller = new AbortController();
  async function* cancelled() {
    yield historyEvent(user('hi'), 0);
    controller.abort();
    controller.signal.throwIfAborted();
  }
  await assert.rejects(
    titledHistoryChat({ ...chat, title: 'hi' }, cancelled(), controller.signal),
    { name: 'AbortError' },
  );
});
