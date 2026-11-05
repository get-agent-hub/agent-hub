import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { historyFixture } from './helpers/history.mjs';

test('production CLI captures, searches, pages, rebuilds and applies exact reviewed archive policy from an unrelated directory', async (t) => {
  const f = await historyFixture(t);
  const env = {
    ...process.env,
    AGENT_HUB_HOME: f.root,
    CLAUDE_CONFIG_DIR: path.dirname(f.source.root),
    AGENT_HUB_CLAUDE_CONFIG: path.join(f.temporary, 'absent.json'),
    CODEX_HOME: path.join(f.temporary, 'absent-codex'),
    DSH_HOME: path.join(f.temporary, 'absent-dsh'),
  };
  const cli = path.resolve('dist/cli.js');
  const run = (...args) =>
    JSON.parse(
      execFileSync(process.execPath, [cli, 'history', ...args], {
        cwd: f.other,
        env,
        encoding: 'utf8',
      }),
    );
  const scan = run('scan', '--client', 'claude-code', '--root', f.source.root);
  assert.equal(scan.chats, 1);
  assert.equal(scan.events, 4);
  const list = run('ls');
  const id = list.chats[0].id;
  assert.equal(run('show', id, '--limit', '2').next, 2);
  assert.equal(run('search', 'Middle sentinel 🦊').total, 1);
  assert.match(run('event', id, '3').text, /retained extension/);
  assert.equal(run('status').events, 4);
  assert.equal(run('rebuild').rebuilt, 1);
  const file = path.join(f.temporary, 'policy.json');
  await fs.writeFile(
    file,
    JSON.stringify({
      operation: 'label',
      id: list.chats[0].projects[0],
      label: 'Readable CLI project',
    }),
  );
  const plan = run('policy', file);
  assert.equal(plan.change.label, 'Readable CLI project');
  assert.equal(run('policy', file, '--apply', '--expect', plan.revision).applied, true);
  assert.equal(run('status').projects[0].label, 'Readable CLI project');
  assert.deepEqual(await fs.readdir(f.other), []);
});
