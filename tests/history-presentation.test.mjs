import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { historyEvent } from '../dist/adapters/history/events.js';
import { historySource } from '../dist/adapters/history/sources.js';
import { ingestHistory } from '../dist/core/history/ingest.js';
import {
  listHistory,
  readConversation,
  readHistoryEvent,
  searchHistory,
} from '../dist/core/history/query.js';
import { preserveRaw } from '../dist/core/history/raw.js';
import { readHistory, revisionDirectory, writeHistory } from '../dist/core/history/storage.js';
import { historyFixture } from './helpers/history.mjs';

const operator = { operator: true };
function dshRows(cwd) {
  return [
    { type: 'session', version: 4, id: 'dsh-chat', cwd },
    { type: 'sandbox/mode', seq: 0, time: 1793707664695, data: { mode: 'workspace-write' } },
    {
      type: 'agent/inbox/spliced',
      seq: 1,
      data: { inserted: [{ role: 'user', content: [{ type: 'text', text: 'Readable task' }] }] },
    },
    {
      type: 'system/message',
      seq: 2,
      time: 1793707664759,
      data: {
        message: { role: 'system', content: [{ type: 'text', text: 'Private system context' }] },
      },
    },
    {
      type: 'user/message',
      seq: 3,
      time: 1793707664760,
      data: {
        content: [{ type: 'text', text: 'Runtime-only instructions' }],
        role: 'user',
        id: 'runtime',
        source: { kind: 'runtime-context' },
      },
    },
    {
      type: 'user/message',
      seq: 4,
      time: 1793707664761,
      data: {
        content: [{ type: 'text', text: 'Readable task' }],
        role: 'user',
        id: 'user-1',
        source: { kind: 'user' },
      },
    },
    { type: 'session/title', seq: 5, data: { title: 'Native readable title' } },
    {
      type: 'assistant/message',
      seq: 6,
      time: 1793707672845,
      data: {
        message: {
          role: 'assistant',
          id: 'assistant-1',
          content: [
            { type: 'reasoning', text: 'Preserved reasoning' },
            { type: 'text', text: 'Readable answer' },
            { type: 'tool-call', id: 'call-1', name: 'example', arguments: '{"input":"value"}' },
          ],
        },
        stream: [{ chunk: { text: 'Do not duplicate stream' } }],
      },
    },
    {
      type: 'tool/call',
      seq: 7,
      data: { callId: 'call-1', name: 'example', arguments: '{"input":"value"}' },
    },
    {
      type: 'tool/result',
      seq: 8,
      time: 1793707674083,
      data: {
        message: {
          role: 'tool',
          toolCallId: 'call-1',
          id: 'result-1',
          content: [{ type: 'text', text: 'Readable tool result' }],
        },
      },
    },
    { type: 'step/end', seq: 9, data: { turn: 1, step: 1 } },
  ];
}
async function dshFixture(t) {
  const f = await historyFixture(t);
  const source = historySource('dsh', path.join(f.temporary, 'dsh-store'));
  const file = path.join(source.root, '--project--', 'dsh-chat', 'session.v4.jsonl');
  await fs.mkdir(path.dirname(file), { recursive: true });
  const rows = dshRows(f.project);
  await fs.writeFile(file, f.encode(rows));
  const chat = (await ingestHistory(f.root, [source])).chats[0];
  return { ...f, source, file, rows, chat };
}

test('DSH data envelopes become readable messages with native timestamps, IDs, tool arguments and results', () => {
  const rows = dshRows('/fixture/project');
  const user = historyEvent(rows[5], 5);
  assert.equal(user.text, 'Readable task');
  assert.equal(user.nativeId, 'user-1');
  assert.equal(user.category, 'message');
  assert.equal(user.timestamp, '2026-11-03T12:07:44.761Z');
  const assistant = historyEvent(rows[7], 7);
  assert.equal(assistant.parts.length, 3);
  assert.equal(assistant.parts[1].text, 'Readable answer');
  assert.equal(assistant.parts[2].name, 'example');
  assert.deepEqual(JSON.parse(assistant.parts[2].text), { input: 'value' });
  assert.ok(!assistant.text.includes('Do not duplicate stream'));
  assert.equal(historyEvent(rows[9], 9).text, 'Readable tool result');
  assert.equal(historyEvent(rows[4], 4).category, 'context');
  assert.equal(historyEvent(rows[2], 2).category, 'activity');
});

test('conversation pages skip technical/context records and duplicate tool echoes without losing native event windows', async (t) => {
  const f = await dshFixture(t);
  const first = await readConversation(f.root, operator, f.chat.id, {
    view: 'conversation',
    limit: 2,
  });
  assert.deepEqual(
    first.events.map((event) => event.ordinal),
    [5, 7],
  );
  assert.equal(first.next, 8);
  assert.equal(first.chat.title, 'Native readable title');
  const last = await readConversation(f.root, operator, f.chat.id, {
    view: 'conversation',
    limit: 2,
    offset: first.next,
  });
  assert.deepEqual(
    last.events.map((event) => event.ordinal),
    [9],
  );
  assert.equal(last.next, null);
  assert.equal(last.previous, 5);
  const all = await readConversation(f.root, operator, f.chat.id);
  assert.equal(all.events.length, 11);
  assert.equal(all.events[3].text, 'Private system context');
  assert.deepEqual(
    JSON.parse((await readHistoryEvent(f.root, operator, f.chat.id, 7)).text),
    f.rows[7],
  );
  assert.equal(
    (await searchHistory(f.root, operator, { query: 'Runtime-only', view: 'conversation' })).total,
    0,
  );
  assert.equal(
    (await searchHistory(f.root, operator, { query: 'Runtime-only', view: 'events' })).total,
    1,
  );
  const matches = await searchHistory(f.root, operator, {
    query: 'Readable task',
    view: 'conversation',
  });
  assert.equal(matches.total, 1);
  assert.equal(matches.matches[0].snippet, 'Readable task');
});

test('previously captured generic indexes and titles are corrected at read time without reimport or archive writes', async (t) => {
  const f = await dshFixture(t);
  const directory = await revisionDirectory(f.root, f.chat.id, f.chat.revision);
  const old = f.rows.map((raw, ordinal) => ({
    ordinal,
    nativeId: null,
    parentId: null,
    timestamp: null,
    type: raw.type,
    role: 'event',
    text: JSON.stringify(raw),
    raw,
  }));
  const temporary = path.join(f.temporary, 'old-projection');
  await fs.mkdir(temporary);
  const index = path.join(temporary, 'events.jsonl');
  await fs.writeFile(index, f.encode(old));
  await preserveRaw(f.root, index, temporary, undefined, 'events');
  await fs.rename(path.join(temporary, 'events.json'), path.join(directory, 'events.json'));
  const catalog = await readHistory(f.root);
  catalog.chats[0].title = `Conversation ${f.chat.nativeId}`;
  await writeHistory(f.root, catalog);
  const catalogFile = path.join(f.root, 'state', 'history', 'catalog.json');
  const before = await fs.readFile(catalogFile);
  await fs.rm(f.source.root, { recursive: true });
  assert.equal((await listHistory(f.root, operator)).chats[0].title, 'Native readable title');
  const view = await readConversation(f.root, operator, f.chat.id, { view: 'conversation' });
  assert.deepEqual(
    view.events.map((event) => event.text),
    [
      'Readable task',
      'Preserved reasoning\nReadable answer\nTool: example\n{\n  "input": "value"\n}',
      'Readable tool result',
    ],
  );
  assert.deepEqual(await fs.readFile(catalogFile), before);
});

test('Claude and Codex content blocks keep readable text and complete original tool data', () => {
  const claude = historyEvent(
    {
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Claude text' },
          { type: 'thinking', thinking: 'Thought' },
          { type: 'tool_use', id: 'c', name: 'read', input: { path: '/fixture/file' } },
        ],
      },
    },
    0,
  );
  assert.equal(claude.parts[0].text, 'Claude text');
  assert.equal(claude.parts[1].kind, 'reasoning');
  assert.equal(claude.parts[2].kind, 'tool-call');
  const call = historyEvent(
    {
      type: 'response_item',
      payload: {
        type: 'function_call',
        call_id: 'c',
        name: 'read',
        arguments: '{"path":"/fixture/file"}',
      },
    },
    1,
  );
  assert.equal(call.parts[0].kind, 'tool-call');
  assert.equal(call.role, 'assistant');
  const result = historyEvent(
    {
      type: 'response_item',
      payload: { type: 'function_call_output', call_id: 'c', output: 'Codex tool result' },
    },
    2,
  );
  assert.equal(result.role, 'tool');
  assert.equal(result.parts[0].text, 'Codex tool result');
});
