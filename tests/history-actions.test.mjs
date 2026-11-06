import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { startUiServer } from '../dist/ui/server.js';
import { ingestHistory } from '../dist/core/history/ingest.js';
import { configureBackground } from '../dist/core/history/background.js';
import { historyStartupStatus } from '../dist/core/history/startup.js';
import { historyFixture } from './helpers/history.mjs';

test('HTTP startup and handoff require current operator authority, preserve source bytes and use single-use reviewed startup plans', async (t) => {
  const f = await historyFixture(t);
  const savedEnv = {
    AGENT_HUB_HOME: process.env.AGENT_HUB_HOME,
    DSH_HOME: process.env.DSH_HOME,
    CODEX_HOME: process.env.CODEX_HOME,
    CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR,
  };
  Object.assign(process.env, {
    AGENT_HUB_HOME: f.root,
    DSH_HOME: path.join(f.temporary, 'absent-dsh'),
    CODEX_HOME: path.join(f.temporary, 'absent-codex'),
    CLAUDE_CONFIG_DIR: path.dirname(f.source.root),
  });
  const chat = (await ingestHistory(f.root, [f.source])).chats[0];
  await configureBackground(f.root, [f.source]);
  const native = await fs.readFile(f.file);
  const context = {
    platform: 'darwin',
    home: path.join(f.temporary, 'user'),
    configHome: path.join(f.temporary, 'config'),
    node: process.execPath,
    worker: path.resolve('dist/workers/history-login.js'),
  };
  let ui;
  try {
    ui = await startUiServer({
      port: 0,
      services: {
        state: async () => {
          throw new Error('unused native config');
        },
        historySources: async () => [f.source],
        historyStartupContext: context,
      },
    });
    const { token } = await (await fetch(ui.url + '/api/state')).json();
    const post = (name, body, auth = token, origin) =>
      fetch(ui.url + '/api/history/' + name, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Agent-Hub-Token': auth,
          ...(origin ? { Origin: origin } : {}),
        },
        body: JSON.stringify(body),
      });
    assert.equal((await post('handoff', { id: chat.id, target: 'codex' }, '')).status, 403);
    assert.equal(
      (await post('handoff', { id: chat.id, target: 'codex' }, token, 'https://example.invalid'))
        .status,
      403,
    );
    assert.equal(
      (await post('handoff', { id: chat.id, target: 'codex', root: '/etc' })).status,
      400,
    );
    const packet = await (
      await post('handoff', { id: chat.id, revision: chat.revision, target: 'codex' })
    ).json();
    assert.ok(packet.references[0].link.startsWith(ui.url + '/'));
    assert.equal((await post('startup/preview', { enabled: true }, '')).status, 403);
    assert.equal((await post('startup/preview', { enabled: true, home: '/etc' })).status, 400);
    const preview = await (await post('startup/preview', { enabled: true })).json();
    assert.equal(preview.blocked, false);
    await assert.rejects(fs.stat(context.home), { code: 'ENOENT' });
    assert.equal((await post('startup/apply', { id: preview.id, revision: 'wrong' })).status, 409);
    assert.equal(
      (await post('startup/apply', { id: preview.id, revision: preview.revision })).status,
      409,
      'failed review token consumed',
    );
    const fresh = await (await post('startup/preview', { enabled: true })).json();
    assert.equal(
      (await post('startup/apply', { id: fresh.id, revision: fresh.revision })).status,
      200,
    );
    assert.equal((await historyStartupStatus(f.root, context)).installed, true);
    assert.equal(
      (await post('startup/apply', { id: fresh.id, revision: fresh.revision })).status,
      409,
    );
    const status = await (await post('status', {})).json();
    assert.equal(status.startup.state, 'installed');
    const exclude = await (
      await post('policy/preview', { operation: 'exclude', id: f.source.id, excluded: true })
    ).json();
    assert.equal(
      (await post('policy/apply', { change: exclude.change, revision: exclude.revision })).status,
      200,
    );
    assert.equal(
      (await post('handoff', { id: chat.id, target: 'codex' })).status,
      409,
      'a previously prepared packet does not retain archive access',
    );
    assert.deepEqual(await fs.readFile(f.file), native);
  } finally {
    await ui?.close();
    for (const [name, value] of Object.entries(savedEnv))
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
  }
});
