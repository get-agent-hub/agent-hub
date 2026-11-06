import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fork, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { historySource } from '../dist/adapters/history/sources.js';
import { backgroundStatus, configureBackground } from '../dist/core/history/background.js';
import {
  startHistoryBackground,
  stopHistoryBackground,
} from '../dist/core/history/background-process.js';
import {
  backgroundFile,
  readBackgroundState,
  readBackgroundPolicy,
} from '../dist/core/history/background-state.js';
import { ingestHistory } from '../dist/core/history/ingest.js';
import {
  historyBytes,
  readConversation,
  listHistory,
  searchHistory,
} from '../dist/core/history/query.js';
import { readHistory } from '../dist/core/history/storage.js';
import { withHubLock } from '../dist/shared/hub-lock.js';
import { planHistoryPolicy, applyHistoryPolicy } from '../dist/core/history/policy.js';
import { historyFixture } from './helpers/history.mjs';

async function until(read, matches, message) {
  for (let attempt = 0; attempt < 500; attempt++) {
    const result = await read();
    if (matches(result)) return result;
    await delay(25);
  }
  assert.fail(message);
}

test('background capture updates all three supported client stores and keeps scoped grants, exclusions and deletion markers effective', async (t) => {
  const f = await historyFixture(t);
  const codex = historySource('codex', path.join(f.temporary, 'codex'));
  const dsh = historySource('dsh', path.join(f.temporary, 'custom-dsh'));
  const codexFile = path.join(codex.root, 'sessions', 'rollout.jsonl');
  const dshFile = path.join(dsh.root, 'project', 'session-id', 'session.v4.jsonl');
  for (const file of [codexFile, dshFile]) await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(
    codexFile,
    f.encode([
      { type: 'session_meta', payload: { id: 'codex-background', cwd: f.project, source: 'cli' } },
      {
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: 'Codex background question' }],
        },
      },
    ]),
  );
  await fs.writeFile(
    dshFile,
    f.encode([
      { type: 'session', version: 4, id: 'dsh-background', cwd: f.project },
      {
        type: 'user/message',
        data: { role: 'user', content: [{ type: 'text', text: 'DSH background question' }] },
      },
    ]),
  );
  async function policy(change) {
    const plan = await planHistoryPolicy(f.root, change);
    return applyHistoryPolicy(f.root, change, plan.revision);
  }
  try {
    await startHistoryBackground(f.root, [f.source, codex, dsh], 5);
    const captured = await until(
      () => readHistory(f.root),
      (catalog) => catalog.chats.length === 3,
      'three client archives',
    );
    await until(
      () => backgroundStatus(f.root),
      (status) => !!status.lastSuccess,
      'complete three-source pass',
    );
    const firstSuccess = (await backgroundStatus(f.root)).lastSuccess;
    await policy({
      operation: 'grant',
      id: 'claude-only',
      sources: [f.source.id],
      projects: captured.chats[0].projects,
    });
    const forgotten = captured.chats.find((chat) => chat.client === 'codex');
    await policy({ operation: 'forget', id: forgotten.id });
    await policy({ operation: 'exclude', id: dsh.id, excluded: true });
    await fs.appendFile(
      codexFile,
      f.encode([
        {
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'Forgotten source update' }],
          },
        },
      ]),
    );
    await fs.appendFile(
      dshFile,
      f.encode([
        {
          type: 'assistant/message',
          data: {
            message: {
              role: 'assistant',
              content: [{ type: 'text', text: 'Excluded source update' }],
            },
          },
        },
      ]),
    );
    await fs.appendFile(
      f.file,
      f.encode([{ type: 'user', message: { role: 'user', content: 'Permitted source update' } }]),
    );
    const updated = await until(
      () => readHistory(f.root),
      (catalog) => catalog.chats.find((chat) => chat.client === 'claude-code')?.events === 5,
      'permitted external update',
    );
    assert.equal(updated.chats.length, 2, 'forgotten chat is not recaptured');
    assert.equal(
      updated.chats.find((chat) => chat.client === 'dsh').events,
      2,
      'excluded store is not captured',
    );
    assert.equal((await listHistory(f.root, { grant: 'claude-only' })).total, 1);
    assert.equal(
      (await searchHistory(f.root, { grant: 'claude-only' }, { query: 'Excluded source' })).total,
      0,
    );
    await until(
      () => backgroundStatus(f.root),
      (status) => status.state === 'waiting' && status.lastSuccess !== firstSuccess,
      'complete checked pass before policy mutation',
    );
    await policy({ operation: 'revoke', id: 'claude-only' });
    await assert.rejects(listHistory(f.root, { grant: 'claude-only' }), /not granted|revoked/);
    assert.equal(
      (await readHistory(f.root)).grants.length,
      0,
      'worker does not restore revoked access',
    );
    assert.match(await fs.readFile(codexFile, 'utf8'), /Forgotten source update/);
    assert.match(await fs.readFile(dshFile, 'utf8'), /Excluded source update/);
  } finally {
    await stopHistoryBackground(f.root);
  }
});

test('background capture is independent of its caller, pins selected sources, archives external changes and stops without changing originals', async (t) => {
  const f = await historyFixture(t);
  const omitted = historySource('claude-code', path.join(f.temporary, 'not-selected'));
  await fs.mkdir(path.join(omitted.root, 'project'), { recursive: true });
  await fs.writeFile(path.join(omitted.root, 'project', 'private.jsonl'), f.encode(f.messages));
  try {
    const started = await startHistoryBackground(f.root, [f.source], 5);
    assert.equal(started.running, true);
    assert.deepEqual(started.sources, [f.source.id]);
    await until(
      () => readHistory(f.root),
      (catalog) => catalog.chats.length === 1,
      'initial capture',
    );
    const first = (await readHistory(f.root)).chats[0];
    const pid = (await readBackgroundState(f.root)).pid;
    await startHistoryBackground(f.root, [f.source], 5);
    assert.equal((await readBackgroundState(f.root)).pid, pid, 'idempotent start');
    await assert.rejects(startHistoryBackground(f.root, [omitted], 5), /Turn off/);
    await fs.appendFile(
      f.file,
      f.encode([{ type: 'user', message: { role: 'user', content: 'new external message' } }]),
    );
    const updated = await until(
      () => readHistory(f.root),
      (catalog) => catalog.chats[0]?.events === 5,
      'external append',
    );
    assert.equal(updated.sources.length, 1);
    assert.equal(updated.chats[0].revisions.length, 2);
    assert.equal(
      (await readConversation(f.root, { operator: true }, first.id)).events.at(-1).text,
      'new external message',
    );
    const originalBytes = Buffer.from(
      (await historyBytes(f.root, { operator: true }, first.id, { revision: first.revision })).data,
      'base64',
    );
    assert.equal(originalBytes.toString(), f.encode(f.messages));
    const native = await fs.readFile(f.file);
    const stopped = await stopHistoryBackground(f.root);
    assert.equal(stopped.running, false);
    assert.equal(stopped.enabled, false);
    assert.deepEqual(await fs.readFile(f.file), native);
    assert.equal((await readHistory(f.root)).chats.length, 1);
    assert.equal(
      (await readBackgroundPolicy(f.root)).sources.length,
      1,
      'selection retained while off',
    );
    await assert.rejects(fs.stat(await backgroundFile(f.root, 'lease')), { code: 'ENOENT' });
  } finally {
    await stopHistoryBackground(f.root);
  }
});

test('a failed source retries and recovers, while a replacement directory cannot inherit its binding', async (t) => {
  const f = await historyFixture(t);
  try {
    await startHistoryBackground(f.root, [f.source], 5);
    await until(
      () => backgroundStatus(f.root),
      (status) => !!status.lastSuccess,
      'first successful update',
    );
    const firstSuccess = (await backgroundStatus(f.root)).lastSuccess;
    await fs.rename(f.source.root, f.source.root + '-offline');
    await until(
      () => backgroundStatus(f.root),
      (status) => status.state === 'retrying',
      'missing source retry',
    );
    assert.equal((await backgroundStatus(f.root)).lastSuccess, firstSuccess);
    assert.equal((await readHistory(f.root)).chats.length, 1);
    await fs.mkdir(path.join(f.source.root, 'project'), { recursive: true });
    await fs.writeFile(
      path.join(f.source.root, 'project', 'replacement.jsonl'),
      f.encode(f.messages),
    );
    const previousAttempt = (await backgroundStatus(f.root)).lastAttempt;
    await until(
      () => backgroundStatus(f.root),
      (status) => status.lastAttempt !== previousAttempt,
      'retry replaced source',
    );
    assert.equal((await readHistory(f.root)).chats.length, 1);
    assert.equal((await readHistory(f.root)).receipts[0].coverage, 'unavailable');
    await fs.rm(f.source.root, { recursive: true });
    await fs.rename(f.source.root + '-offline', f.source.root);
    await until(
      () => backgroundStatus(f.root),
      (status) => status.lastSuccess !== firstSuccess,
      'source recovery',
    );
    assert.equal((await readHistory(f.root)).receipts[0].coverage, 'complete');
  } finally {
    await stopHistoryBackground(f.root);
  }
});

test('background update retries Hub contention and stops cooperatively while another operation holds the lock', async (t) => {
  const f = await historyFixture(t);
  try {
    await startHistoryBackground(f.root, [f.source], 5);
    await until(
      () => backgroundStatus(f.root),
      (status) => !!status.lastSuccess,
      'initial update',
    );
    await withHubLock(f.root, async () => {
      await until(
        () => backgroundStatus(f.root),
        (status) => status.state === 'retrying',
        'lock retry',
      );
      const status = await stopHistoryBackground(f.root);
      assert.equal(status.running, false);
    });
    assert.equal((await readHistory(f.root)).chats.length, 1);
    assert.doesNotMatch((await readBackgroundState(f.root)).error, /PRIVATE|native-chat|Error:/);
  } finally {
    await stopHistoryBackground(f.root);
  }
});

test('a crashed worker releases no live owner, a duplicate is rejected and an explicit restart recovers the stale lease', async (t) => {
  const f = await historyFixture(t);
  const policy = await configureBackground(f.root, [f.source], 5);
  const worker = fork(path.resolve('dist/workers/history.js'), [f.root, policy.id], {
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    execArgv: [],
  });
  try {
    assert.deepEqual((await once(worker, 'message'))[0], { ready: true });
    await until(
      () => backgroundStatus(f.root),
      (status) => !!status.lastSuccess,
      'worker idle before crash',
    );
    const duplicate = fork(path.resolve('dist/workers/history.js'), [f.root, policy.id], {
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      execArgv: [],
    });
    assert.equal((await once(duplicate, 'exit'))[0], 1);
    const exited = once(worker, 'exit');
    worker.kill('SIGKILL');
    await exited;
    assert.equal((await backgroundStatus(f.root)).running, false);
    await startHistoryBackground(f.root, [f.source], 5);
    await until(
      () => backgroundStatus(f.root),
      (status) => !!status.lastSuccess,
      'restart after crash',
    );
    assert.equal((await readHistory(f.root)).chats.length, 1);
  } finally {
    if (worker.exitCode === null && worker.signalCode === null) {
      const exited = once(worker, 'exit');
      worker.kill('SIGTERM');
      await exited;
    }
    await stopHistoryBackground(f.root);
  }
});

test('removing or replacing the Hub stops the worker without recreating Hub data', async (t) => {
  const f = await historyFixture(t);
  await startHistoryBackground(f.root, [f.source], 5);
  await until(
    () => backgroundStatus(f.root),
    (status) => !!status.lastSuccess,
    'initial update',
  );
  const state = await readBackgroundState(f.root);
  await fs.rename(f.root, f.root + '-saved');
  await fs.mkdir(f.root);
  await delay(1500);
  assert.deepEqual(await fs.readdir(f.root), []);
  // The old lease belongs to a stopped process. Moving the same Hub back permits explicit resume.
  await fs.rename(f.root, f.root + '-empty');
  await fs.rename(f.root + '-saved', f.root);
  try {
    await until(
      () => backgroundStatus(f.root),
      (status) => !status.running,
      'worker exits on replacement',
    );
    assert.equal((await readBackgroundState(f.root)).pid, state.pid);
    await startHistoryBackground(f.root, [f.source], 5);
    await until(
      () => backgroundStatus(f.root),
      (status) => !!status.lastSuccess,
      'resume after restoration',
    );
  } finally {
    await stopHistoryBackground(f.root);
  }
});

test('CLI background mode uses saved explicit roots and exits while capture continues; empty selection and invalid intervals do not enable it', async (t) => {
  const f = await historyFixture(t);
  await assert.rejects(startHistoryBackground(f.root, [], 5), /at least one/);
  await assert.rejects(startHistoryBackground(f.root, [f.source], 1), /5–300/);
  assert.equal((await backgroundStatus(f.root)).enabled, false);
  assert.equal((await stopHistoryBackground(f.root)).running, false);
  await assert.rejects(fs.stat(f.root), { code: 'ENOENT' });
  await ingestHistory(f.root, [f.source]);
  const env = {
    ...process.env,
    AGENT_HUB_HOME: f.root,
    CLAUDE_CONFIG_DIR: path.join(f.temporary, 'not-the-saved-root'),
    CODEX_HOME: path.join(f.temporary, 'absent-codex'),
    DSH_HOME: path.join(f.temporary, 'absent-dsh'),
  };
  const cli = path.resolve('dist/cli.js');
  const run = (...args) =>
    JSON.parse(
      execFileSync(process.execPath, [cli, 'history', ...args], {
        env,
        cwd: f.other,
        encoding: 'utf8',
        timeout: 15000,
      }),
    );
  try {
    assert.equal(run('watch', '--background', '--interval', '5').running, true);
    await until(
      () => backgroundStatus(f.root),
      (status) => !!status.lastSuccess,
      'detached CLI update',
    );
    assert.deepEqual(run('status').background.sources, [f.source.id]);
    assert.equal(run('watch', '--stop').running, false);
    assert.equal((await readHistory(f.root)).chats.length, 1);
  } finally {
    await stopHistoryBackground(f.root);
  }
});
