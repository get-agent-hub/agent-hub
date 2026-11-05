import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { historySource, historySources, historyFiles } from '../dist/adapters/history/sources.js';
import { zstdFrames } from '../dist/adapters/history/zstd.js';
import { ingestHistory } from '../dist/core/history/ingest.js';
import { readConversation, historyBytes, searchHistory } from '../dist/core/history/query.js';
import { readHistory, revisionDirectory } from '../dist/core/history/storage.js';
import { xxhashChecksum } from '../dist/shared/xxhash.js';
import { historyFixture } from './helpers/history.mjs';

const operator = { operator: true };
test('Codex active and archived rollouts, Claude subagents and DSH headers retain native identity and explicit lineage', async (t) => {
  const { temporary, root, source, project, encode } = await historyFixture(t);
  const child = path.join(
    source.root,
    'encoded-project',
    'native-chat',
    'subagents',
    'agent-child.jsonl',
  );
  await fs.mkdir(path.dirname(child), { recursive: true });
  await fs.writeFile(
    child,
    encode([
      {
        type: 'assistant',
        uuid: 'child',
        sessionId: 'child-native',
        isSidechain: true,
        cwd: project,
        message: { role: 'assistant', content: 'Child conversation' },
      },
    ]),
  );
  const codex = historySource('codex', path.join(temporary, 'codex'));
  for (const name of [
    'sessions/2026/11/05/rollout-one.jsonl',
    'archived_sessions/rollout-two.jsonl',
  ]) {
    const file = path.join(codex.root, name);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(
      file,
      encode([
        { type: 'session_meta', payload: { id: name, cwd: project, source: 'cli' } },
        {
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: 'Codex sentinel' }],
          },
        },
      ]),
    );
  }
  const dsh = historySource('dsh', path.join(temporary, 'dsh'));
  const file = path.join(dsh.root, '--project--', 'child', 'session.v4.jsonl');
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(
    file,
    encode([
      {
        type: 'session',
        version: 4,
        id: 'dsh-child',
        cwd: project,
        parentSession: 'dsh-parent',
        origin: 'subagent',
      },
      { type: 'user/message', message: { role: 'user', content: 'DSH sentinel' } },
    ]),
  );
  const catalog = await ingestHistory(root, [source, codex, dsh]);
  assert.equal(catalog.chats.length, 5);
  assert.equal(catalog.projects.length, 1);
  assert.equal(
    catalog.chats.find((chat) => chat.nativeId === 'child-native').parentNativeId,
    'native-chat',
  );
  const dshChat = catalog.chats.find((chat) => chat.nativeId === 'dsh-child');
  assert.equal(dshChat.kind, 'subagent');
  assert.equal(dshChat.parentNativeId, 'dsh-parent');
  assert.equal((await searchHistory(root, operator, { query: 'Codex sentinel' })).total, 2);
  assert.equal((await searchHistory(root, operator, { query: 'DSH sentinel' })).total, 1);
});

test('DSH checksummed concatenated Zstandard frames read on the minimum runtime, with torn tails and checksum failures distinct', async (t) => {
  const { temporary, root } = await historyFixture(t);
  const fixture = JSON.parse(
    await fs.readFile(new URL('./fixtures/history-zstd.json', import.meta.url), 'utf8'),
  );
  const source = historySource('dsh', path.join(temporary, 'compressed'));
  const file = path.join(source.root, '--project--', 'compressed-session', 'session.v4.jsonl.zstd');
  await fs.mkdir(path.dirname(file), { recursive: true });
  const bytes = Buffer.from(fixture.base64, 'base64');
  await fs.writeFile(file, bytes);
  let catalog = await ingestHistory(root, [source]);
  let chat = catalog.chats[0];
  assert.equal(chat.events, 3);
  assert.equal(chat.content, 'complete');
  assert.equal((await searchHistory(root, operator, { query: 'Compressed sentinel' })).total, 1);
  assert.deepEqual(
    Buffer.from((await historyBytes(root, operator, chat.id)).data, 'base64'),
    bytes,
  );
  await fs.writeFile(file, bytes.subarray(0, bytes.length - 3));
  catalog = await ingestHistory(root, [source]);
  chat = catalog.chats[0];
  assert.equal(chat.content, 'pending-tail');
  assert.equal(chat.events, 2);
  const corrupt = Buffer.from(bytes);
  corrupt[corrupt.length - 1] ^= 1;
  await fs.writeFile(file, corrupt);
  const progress = { pending: false, bytes: 0 };
  await assert.rejects(async () => {
    for await (const _chunk of zstdFrames(file, progress)) {
      /* consume */
    }
  }, /checksum/);
  catalog = await ingestHistory(root, [source]);
  assert.equal(catalog.chats[0].content, 'unsupported');
  assert.equal(xxhashChecksum(Buffer.alloc(0)), 0x51d8e999);
});

test('native in-store attachments are copied byte-for-byte, while outside paths, symlinks and remote references are not fetched', async (t) => {
  const { temporary, root, source, file, messages, encode } = await historyFixture(t);
  const asset = path.join(source.root, 'asset.bin');
  const bytes = Buffer.from([0, 1, 2, 255]);
  await fs.writeFile(asset, bytes);
  const outside = path.join(temporary, 'private.bin');
  await fs.writeFile(outside, 'must not copy');
  const symlink = path.join(source.root, 'linked.bin');
  await fs.symlink(outside, symlink);
  messages.push({
    type: 'user',
    message: {
      role: 'user',
      content: [
        { type: 'image', file_path: asset },
        { type: 'image', file_path: outside },
        { type: 'image', file_path: symlink },
        { type: 'image_url', url: 'https://example.invalid/asset?token=hidden' },
        { type: 'image_url', url: 'data:image/png;base64,AA==' },
      ],
    },
  });
  await fs.writeFile(file, encode(messages));
  const chat = (await ingestHistory(root, [source])).chats[0];
  assert.equal(chat.assets.filter((item) => item.status === 'preserved').length, 1);
  assert.equal(chat.assets.filter((item) => item.status === 'outside-source').length, 2);
  assert.equal(chat.assets.filter((item) => item.status === 'remote').length, 1);
  assert.ok(!JSON.stringify(chat.assets).includes('token=hidden'));
  assert.ok(!JSON.stringify(chat.assets).includes('base64,AA=='));
  const id = chat.assets.find((item) => item.status === 'preserved').id;
  assert.deepEqual(
    Buffer.from((await historyBytes(root, operator, chat.id, { asset: id })).data, 'base64'),
    bytes,
  );
  assert.deepEqual(await fs.readFile(asset), bytes);
  assert.equal(await fs.readFile(outside, 'utf8'), 'must not copy');
});

test('source failures and cancellation retain completed units, while sibling sources continue independently', async (t) => {
  const { root, source, file, encode, messages } = await historyFixture(t);
  await fs.writeFile(
    path.join(path.dirname(file), 'second.jsonl'),
    encode([{ ...messages[0], sessionId: 'second-chat' }]),
  );
  const controller = new AbortController();
  await assert.rejects(
    ingestHistory(root, [source], {
      signal: controller.signal,
      onProgress() {
        controller.abort();
      },
    }),
  );
  assert.equal((await readHistory(root)).chats.length, 1);
  const catalog = await ingestHistory(root, [source]);
  assert.equal(catalog.chats.length, 2);
  const sourceLink = path.join(source.root, 'outside.jsonl');
  await fs.symlink('/nonexistent', sourceLink);
  assert.equal((await ingestHistory(root, [source])).chats.length, 2);
  const invalid = historySource('codex', file);
  const next = await ingestHistory(root, [invalid, source]);
  assert.equal(
    next.receipts.find((receipt) => receipt.source.id === invalid.id).coverage,
    'unavailable',
  );
  assert.equal(
    next.receipts.find((receipt) => receipt.source.id === source.id).coverage,
    'complete',
  );
});

test('metadata discovery honors known roots and DSH literal profile configuration without executing plugins', async (t) => {
  const { temporary, source } = await historyFixture(t);
  const values = {
    CLAUDE_CONFIG_DIR: path.dirname(source.root),
    CODEX_HOME: path.join(temporary, 'codex'),
    DSH_HOME: path.join(temporary, 'dsh-home'),
  };
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  Object.assign(process.env, values);
  t.after(() => {
    for (const [key, value] of Object.entries(previous))
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
  });
  const custom = path.join(temporary, 'custom-dsh-store');
  await fs.mkdir(custom);
  const profile = path.join(values.DSH_HOME, 'profiles', 'custom', 'cordis.patch.yml');
  await fs.mkdir(path.dirname(profile), { recursive: true });
  await fs.writeFile(
    profile,
    `- name: '@deepseek-ai/dsh-session-persistence-jsonl'\n  config:\n    root: ${JSON.stringify(custom)}\n`,
  );
  const cyclic = path.join(values.DSH_HOME, 'profiles', 'cyclic', 'cordis.patch.yml');
  await fs.mkdir(path.dirname(cyclic), { recursive: true });
  await fs.writeFile(cyclic, 'loop: &loop\n  next: *loop\n');
  const sources = await historySources();
  const physicalRoot = await fs.realpath(custom);
  assert.ok(sources.some((item) => item.root === physicalRoot));
  const files = [];
  for await (const item of historyFiles(source)) files.push(item);
  assert.equal(files.length, 1);
});

test('shared blocks deduplicate unchanged prefixes across large append revisions and detect corrupted objects', async (t) => {
  const { root, source, file, messages, encode } = await historyFixture(t);
  messages[0].message.content[0].text = 'large ' + 'x'.repeat(2200000);
  await fs.writeFile(file, encode(messages));
  let chat = (await ingestHistory(root, [source])).chats[0];
  const oldDir = await revisionDirectory(root, chat.id, chat.revision);
  const before = JSON.parse(await fs.readFile(path.join(oldDir, 'raw.json'), 'utf8'));
  await fs.appendFile(
    file,
    encode([{ type: 'user', message: { role: 'user', content: 'appended' } }]),
  );
  chat = (await ingestHistory(root, [source])).chats[0];
  const newDir = await revisionDirectory(root, chat.id, chat.revision);
  const after = JSON.parse(await fs.readFile(path.join(newDir, 'raw.json'), 'utf8'));
  assert.deepEqual(before.blocks.slice(0, 2), after.blocks.slice(0, 2));
  await fs.writeFile(
    path.join(root, 'state', 'history', 'objects', after.blocks[0].id),
    'corrupted',
  );
  await assert.rejects(historyBytes(root, operator, chat.id), /integrity/);
  assert.equal(
    (await readConversation(root, operator, chat.id, { offset: 4 })).events[0].text,
    'appended',
  );
});
