import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { prepareHistoryHandoff } from '../dist/core/history/handoff.js';
import { ingestHistory } from '../dist/core/history/ingest.js';
import { readHistory, revisionDirectory } from '../dist/core/history/storage.js';
import { applyHistoryPolicy, planHistoryPolicy } from '../dist/core/history/policy.js';
import { historyFixture } from './helpers/history.mjs';
const operator = { operator: true };
async function policy(root, change) {
  const plan = await planHistoryPolicy(root, change);
  return applyHistoryPolicy(root, change, plan.revision);
}

test('handoff is a read-only, version-pinned context packet with exact excerpts, target and original references, not invented decisions', async (t) => {
  const f = await historyFixture(t);
  const chat = (await ingestHistory(f.root, [f.source])).chats[0];
  const catalog = await fs.readFile(path.join(f.root, 'state/history/catalog.json'));
  await fs.rm(f.source.root, { recursive: true });
  const packet = await prepareHistoryHandoff(
    f.root,
    operator,
    { id: chat.id, target: 'codex', nextStep: 'Review the pending retry changes.' },
    { origin: 'http://127.0.0.1:1234' },
  );
  assert.equal(packet.revision, chat.revision);
  assert.equal(packet.target, 'codex');
  assert.deepEqual(
    packet.references.map((ref) => ref.ordinal),
    [0, 1],
  );
  assert.equal(packet.references[1].text, 'Middle sentinel 🦊');
  assert.ok(packet.references.every((ref) => ref.link.includes(chat.revision)));
  assert.ok(packet.references.every((ref) => ref.link.startsWith('http://127.0.0.1:1234/')));
  assert.match(packet.text, /Review the pending retry changes/);
  assert.doesNotMatch(
    packet.text,
    /not executed by Hub|End sentinel with a tool result|retained extension/,
  );
  assert.match(packet.text, /not an AI summary/);
  assert.match(packet.text, /separately configured History MCP/);
  assert.deepEqual(await fs.readFile(path.join(f.root, 'state/history/catalog.json')), catalog);
});

test('old-version handoffs keep their own messages after native changes; runtime context and tool output stay out of the packet', async (t) => {
  const f = await historyFixture(t);
  f.messages.unshift({
    type: 'user',
    message: {
      role: 'user',
      content: '<environment_context>RUNTIME_CONTEXT_SENTINEL</environment_context>',
    },
  });
  await fs.writeFile(f.file, f.encode(f.messages));
  const chat = (await ingestHistory(f.root, [f.source])).chats[0];
  await fs.appendFile(
    f.file,
    f.encode([
      { type: 'assistant', message: { role: 'assistant', content: 'NEW_REVISION_SENTINEL' } },
    ]),
  );
  await ingestHistory(f.root, [f.source]);
  const packet = await prepareHistoryHandoff(f.root, operator, {
    id: chat.id,
    revision: chat.revision,
    target: 'dsh',
  });
  assert.doesNotMatch(packet.text, /NEW_REVISION_SENTINEL|RUNTIME_CONTEXT_SENTINEL/);
  assert.equal(packet.revision, chat.revision);
  assert.match(
    (await prepareHistoryHandoff(f.root, operator, { id: chat.id, target: 'claude-code' })).text,
    /NEW_REVISION_SENTINEL/,
  );
});

test('bounded handoffs keep the first request and recent messages across large boundary records without hiding omissions', async (t) => {
  const f = await historyFixture(t);
  const huge = {
    type: 'assistant',
    message: { role: 'assistant', content: 'HUGE_MIDDLE ' + 'x'.repeat(2 * 1024 * 1024) },
  };
  await fs.writeFile(
    f.file,
    f.encode([
      ...f.messages,
      huge,
      ...Array.from({ length: 15 }, (_, i) => ({
        type: 'user',
        message: { role: 'user', content: `Recent request ${i} <script>example</script>` },
      })),
    ]),
  );
  const chat = (await ingestHistory(f.root, [f.source])).chats[0];
  const packet = await prepareHistoryHandoff(f.root, operator, { id: chat.id, target: 'codex' });
  assert.ok(packet.references.length <= 11);
  assert.equal(packet.references[0].text, 'A useful conversation title');
  assert.match(packet.references.at(-1).text, /Recent request 14/);
  assert.ok(packet.warnings.some((warning) => warning.includes('Middle events')));
  assert.ok(packet.text.length < 40000);
});

test('handoff rechecks grants, project/source exclusions and revoked access without creating an export or broadening permissions', async (t) => {
  const f = await historyFixture(t);
  const chat = (await ingestHistory(f.root, [f.source])).chats[0];
  const input = { id: chat.id, target: 'codex' };
  await assert.rejects(prepareHistoryHandoff(f.root, { grant: 'client' }, input), /not granted/);
  await policy(f.root, {
    operation: 'grant',
    id: 'client',
    projects: chat.projects,
    sources: [f.source.id],
  });
  assert.ok((await prepareHistoryHandoff(f.root, { grant: 'client' }, input)).references.length);
  await policy(f.root, { operation: 'exclude', id: f.source.id, excluded: true });
  await assert.rejects(prepareHistoryHandoff(f.root, operator, input), /permitted scope/);
  await policy(f.root, { operation: 'exclude', id: f.source.id, excluded: false });
  await policy(f.root, { operation: 'revoke', id: 'client' });
  await assert.rejects(prepareHistoryHandoff(f.root, { grant: 'client' }, input), /revoked/);
  assert.equal((await readHistory(f.root)).grants.length, 0);
  assert.deepEqual(await fs.readdir(f.other), []);
});

test('handoff refuses corrupt selected blocks, unknown revisions, path injection and invalid clients', async (t) => {
  const f = await historyFixture(t);
  const chat = (await ingestHistory(f.root, [f.source])).chats[0];
  await assert.rejects(
    prepareHistoryHandoff(f.root, operator, { id: '../etc', target: 'codex' }),
    /supported target/,
  );
  await assert.rejects(
    prepareHistoryHandoff(f.root, operator, { id: chat.id, target: 'unknown' }),
    /supported target/,
  );
  await assert.rejects(
    prepareHistoryHandoff(f.root, operator, {
      id: chat.id,
      target: 'codex',
      revision: '0'.repeat(64),
    }),
    /Unknown conversation revision/,
  );
  const descriptor = JSON.parse(
    await fs.readFile(
      path.join(await revisionDirectory(f.root, chat.id, chat.revision), 'events.json'),
      'utf8',
    ),
  );
  await fs.appendFile(
    path.join(f.root, 'state/history/objects', descriptor.blocks[0].id),
    'broken',
  );
  await assert.rejects(
    prepareHistoryHandoff(f.root, operator, { id: chat.id, target: 'codex' }),
    /integrity/,
  );
});

test('CLI prepares portable context from an unrelated folder without changing client files', async (t) => {
  const f = await historyFixture(t);
  const chat = (await ingestHistory(f.root, [f.source])).chats[0];
  const native = await fs.readFile(f.file);
  const packet = JSON.parse(
    execFileSync(
      process.execPath,
      [
        path.resolve('dist/cli.js'),
        'history',
        'handoff',
        chat.id,
        '--client',
        'codex',
        '--next',
        'Check the build',
      ],
      { cwd: f.other, env: { ...process.env, AGENT_HUB_HOME: f.root }, encoding: 'utf8' },
    ),
  );
  assert.match(packet.text, /Check the build/);
  assert.equal(packet.references[0].ordinal, 0);
  assert.deepEqual(await fs.readFile(f.file), native);
  assert.deepEqual(await fs.readdir(f.other), []);
});
