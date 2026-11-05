import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { addRemote, commitPaths, initRepo } from '../dist/shared/git.js';

test('explicit Git context cannot mutate the unrelated default Hub', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ahub-git-context-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const selected = path.join(directory, 'selected hub');
  const unrelated = path.join(directory, 'unrelated hub');
  await fs.mkdir(selected);
  await fs.mkdir(unrelated);
  const values = {
    AGENT_HUB_HOME: unrelated,
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
  };
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  Object.assign(process.env, values);
  t.after(() => {
    for (const [key, value] of Object.entries(previous))
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
  });
  const git = (...args) =>
    execFileSync('git', ['-C', selected, ...args], { encoding: 'utf8' }).trim();
  initRepo(selected);
  git('config', 'user.name', 'Fixture');
  git('config', 'user.email', 'fixture@example.invalid');
  git('config', 'core.hooksPath', '/dev/null');
  await fs.writeFile(path.join(selected, 'hub.yaml'), 'version: 1\n');
  addRemote('https://example.invalid/hub.git', selected);
  assert.ok(commitPaths(['hub.yaml'], 'fixture: selected hub', selected));
  assert.equal(git('remote', 'get-url', 'origin'), 'https://example.invalid/hub.git');
  assert.equal(git('show', 'HEAD:hub.yaml'), 'version: 1');
  assert.equal(commitPaths(['hub.yaml'], 'fixture: no changes', selected), undefined);
  assert.deepEqual(await fs.readdir(unrelated), []);
});
