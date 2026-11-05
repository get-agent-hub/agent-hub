import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { claudeSessions } from '../dist/adapters/claude-sessions.js';
import { discoverProjects } from '../dist/core/projects/discovery.js';
import { fixture, limits } from './helpers/project-discovery.mjs';

test('does not infer a project from encoded directory names or parse an incomplete final record', async (t) => {
  const f = await fixture(t);
  const file = await f.session('unfinished', [], '-pretend-project-path');
  await fs.writeFile(file, JSON.stringify({ sessionId: 'unfinished', cwd: f.root }));
  let scan = await claudeSessions(f.home);
  assert.equal(scan.coverage, 'partial');
  assert.deepEqual(scan.sessions, []);
  await fs.appendFile(file, '\n');
  scan = await claudeSessions(f.home);
  assert.equal(scan.sessions.length, 1);
  assert.equal(scan.sessions[0].locations[0], f.root);
});

test('bounded prefix, file and directory limits report partial coverage without leaking malformed input', async (t) => {
  const f = await fixture(t);
  await f.session('one', [f.root]);
  await f.session('two', [f.root]);
  const scan = await claudeSessions(f.home, { entries: 100, files: 1, bytes: 1024, prefix: 1024 });
  assert.equal(scan.coverage, 'partial');
  assert.equal(scan.filesRead, 1);
  assert.ok(scan.bytesRead <= 1024);
  const limited = await claudeSessions(f.home, {
    entries: 1,
    files: 100,
    bytes: 1024,
    prefix: 128,
  });
  assert.equal(limited.coverage, 'partial');
  const file = await f.session('malformed', [f.root]);
  await fs.writeFile(file, '{ private-malformed-transcript\n' + 'x'.repeat(80000));
  const invalid = await claudeSessions(f.home);
  assert.equal(invalid.coverage, 'partial');
  assert.ok(!JSON.stringify(invalid).includes('private-malformed-transcript'));
  assert.ok(invalid.bytesRead < 1024 * 1024);
});

test('skips sidechains, symlinked collections/files and unsafe project paths', async (t) => {
  const f = await fixture(t);
  const sidechain = await f.session('child', [f.root]);
  await fs.writeFile(
    sidechain,
    JSON.stringify({ sessionId: 'child', cwd: f.root, isSidechain: true }) + '\n',
  );
  const outside = path.join(f.root, 'outside');
  await fs.mkdir(outside);
  await fs.writeFile(
    path.join(outside, 'external.jsonl'),
    JSON.stringify({ sessionId: 'external', cwd: '/must-not-be-in-result' }) + '\n',
  );
  await fs.symlink(outside, path.join(f.home, 'projects', 'linked-collection'));
  await fs.symlink(
    path.join(outside, 'external.jsonl'),
    path.join(path.dirname(sidechain), 'linked.jsonl'),
  );
  await f.session('unsafe', ['relative/path', '/tmp/unsafe\npath']);
  const result = await discoverProjects(['claude-code'], [f.adapter]);
  assert.equal(result.coverage, 'partial');
  assert.deepEqual(result.projects, []);
  assert.ok(!JSON.stringify(result).includes('must-not-be-in-result'));
});

test('missing/unreadable stores and unsupported capabilities are explicit and never read another client', async (t) => {
  const f = await fixture(t);
  assert.equal((await claudeSessions(path.join(f.root, 'absent'))).coverage, 'not-found');
  await fs.writeFile(path.join(f.root, 'not-directory'), 'fixture');
  assert.equal((await claudeSessions(path.join(f.root, 'not-directory'))).coverage, 'unavailable');
  const sources = [
    {
      ...f.adapter,
      discoverSessions: () => {
        throw new Error('private-error-content');
      },
    },
    { id: 'codex', label: 'Codex' },
  ];
  const unsupported = await discoverProjects(['codex'], sources);
  assert.equal(unsupported.sources[0].coverage, 'unsupported');
  const failed = await discoverProjects(['claude-code'], sources);
  assert.equal(failed.sources[0].coverage, 'unavailable');
  assert.ok(!JSON.stringify(failed).includes('private-error-content'));
  await assert.rejects(discoverProjects(['unknown'], sources), /known clients/);
  await assert.rejects(discoverProjects(['codex', 'codex'], sources), /known clients/);
});

test('exact file, entry and byte thresholds are complete, while genuinely remaining work is partial', async (t) => {
  const f = await fixture(t);
  const file = await f.session('one', [f.root]);
  const bytes = (await fs.stat(file)).size;
  const exact = await claudeSessions(f.home, { ...limits, entries: 2, files: 1, bytes });
  assert.equal(exact.coverage, 'complete');
  assert.equal(exact.finished, true);
  assert.equal(exact.filesRead, 1);
  assert.equal(exact.entriesRead, 2);
  assert.equal(exact.bytesRead, bytes);
  await f.session('two', [f.root]);
  const partial = await claudeSessions(f.home, { ...limits, files: 1 });
  assert.equal(partial.coverage, 'partial');
  assert.equal(partial.finished, false);
  assert.equal(partial.filesRead, 1);
});

test('one run continues beyond four MiB in bounded batches and reaches late collections fairly', async (t) => {
  const f = await fixture(t);
  for (let index = 0; index < 80; index++) {
    const file = await f.session(`large-${index}`, [f.root], 'early-large');
    await fs.appendFile(
      file,
      JSON.stringify({
        type: 'assistant',
        message: { content: 'private-large-body'.repeat(5000) },
      }) + '\n',
    );
  }
  await f.session('late', [f.root], 'late-small');
  const batches = [];
  const report = await claudeSessions(f.home, undefined, {
    onBatch: async (batch) => {
      if (batch.sessions.length) batches.push(batch.sessions.map((session) => session.id));
    },
  });
  assert.equal(report.coverage, 'complete');
  assert.equal(report.filesRead, 81);
  assert.equal(report.totalFiles, 81);
  assert.ok(report.bytesRead > 4 * 1024 * 1024);
  assert.ok(batches.every((batch) => batch.length <= 32));
  assert.ok(batches[0].includes('late'));
  assert.equal(new Set(batches.flat()).size, 81);
  assert.deepEqual(report.sessions, []);
});

test('valid large UTF-8 first records yield metadata without interpreting nested message fields', async (t) => {
  const f = await fixture(t);
  const file = await f.session('large', [f.root]);
  await fs.writeFile(
    file,
    JSON.stringify({
      type: 'user',
      sessionId: 'large',
      cwd: f.root,
      message: { content: '😀'.repeat(30000), cwd: '/decoy-path' },
    }) + '\n',
  );
  const result = await claudeSessions(f.home);
  assert.equal(result.coverage, 'complete');
  assert.ok(result.bytesRead > 64 * 1024);
  assert.deepEqual(result.sessions, [{ id: 'large', locations: [f.root] }]);
  assert.ok(!JSON.stringify(result).includes('😀'));
  await fs.writeFile(
    file,
    JSON.stringify({
      type: 'user',
      sessionId: 'large',
      message: { cwd: '/decoy-path', content: '"cwd":"/fake"' },
    }) + '\n',
  );
  const nested = await claudeSessions(f.home);
  assert.deepEqual(nested.sessions, []);
  assert.equal(nested.unresolvedFiles, 1);
});

test('oversized per-session location metadata is unresolved and never silently counted as complete', async (t) => {
  const f = await fixture(t);
  await f.session(
    'many',
    Array.from({ length: 500 }, (_, index) => path.join(f.root, `folder-${index}`)),
  );
  const scan = await claudeSessions(f.home);
  assert.equal(scan.coverage, 'partial');
  assert.equal(scan.unresolvedFiles, 1);
  assert.equal(scan.sessions.length, 0);
});

test('source cancellation closes its iterators and the next independent scan can finish', async (t) => {
  const f = await fixture(t);
  for (let index = 0; index < 65; index++) await f.session(`chat-${index}`, [f.root]);
  const controller = new AbortController();
  await assert.rejects(
    claudeSessions(f.home, undefined, {
      signal: controller.signal,
      onBatch: async (batch) => {
        if (batch.sessions.length) controller.abort();
      },
    }),
    { name: 'AbortError' },
  );
  const next = await claudeSessions(f.home);
  assert.equal(next.coverage, 'complete');
  assert.equal(next.filesRead, 65);
});

test('collection changes during scanning remain partial until a fresh scan observes the new inventory', async (t) => {
  const f = await fixture(t);
  for (let index = 0; index < 35; index++) await f.session(`chat-${index}`, [f.root]);
  let changed = false;
  const result = await claudeSessions(f.home, undefined, {
    onBatch: async (batch) => {
      if (!changed && batch.sessions.length) {
        changed = true;
        await f.session('added-during-scan', [f.root]);
      }
    },
  });
  assert.equal(result.coverage, 'partial');
  assert.match(result.issues.join(' '), /changed/);
  const next = await claudeSessions(f.home);
  assert.equal(next.filesRead, 36);
  assert.equal(next.coverage, 'complete');
});
