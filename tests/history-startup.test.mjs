import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { configureBackground, requestBackgroundStop } from '../dist/core/history/background.js';
import {
  backgroundFile,
  backgroundBinding,
  writeBackground,
} from '../dist/core/history/background-state.js';
import {
  planHistoryStartup,
  applyHistoryStartup,
  historyStartupStatus,
} from '../dist/core/history/startup.js';
import { startupDefinition } from '../dist/core/history/startup-definition.js';
import { readHistory } from '../dist/core/history/storage.js';
import { applyManagedPlan, planManagedRestore } from '../dist/core/recovery/managed-plan.js';
import { historyFixture } from './helpers/history.mjs';

async function fixture(t, platform = 'darwin') {
  const f = await historyFixture(t);
  const context = {
    platform,
    home: path.join(f.temporary, 'home'),
    configHome: path.join(f.temporary, 'config'),
    node: process.execPath,
    worker: path.resolve('dist/workers/history-login.js'),
  };
  const policy = await configureBackground(f.root, [f.source], 5);
  const plan = (enabled = true) => planHistoryStartup(f.root, enabled, context);
  const apply = async (enabled = true) => {
    const saved = await plan(enabled);
    return applyHistoryStartup(saved, saved.plan.revision);
  };
  return { ...f, context, policy, plan, apply };
}

for (const platform of ['darwin', 'linux'])
  test(`${platform} startup previews without writing, installs only reviewed user files, repeats without writes and removes through recovery`, async (t) => {
    const f = await fixture(t, platform);
    const saved = await f.plan();
    const files = saved.plan.rows.map((row) => row.path);
    for (const file of files) await assert.rejects(fs.lstat(file), { code: 'ENOENT' });
    assert.equal(saved.plan.blocked, false);
    await assert.rejects(applyHistoryStartup(saved, 'stale'), /reviewed dry run/);
    const result = await applyHistoryStartup(saved, saved.plan.revision);
    assert.ok(result.backup);
    assert.equal((await historyStartupStatus(f.root, f.context)).state, 'installed');
    assert.equal((await f.apply()).changedPaths, 0);
    if (platform === 'linux') {
      const link = files.find((file) => file.includes('default.target.wants'));
      assert.equal((await fs.lstat(link)).isSymbolicLink(), true);
      assert.equal(await fs.realpath(link), await fs.realpath(files[0]));
    } else if (process.platform === 'darwin') {
      const parsed = JSON.parse(
        execFileSync('plutil', ['-convert', 'json', '-o', '-', files[0]], { encoding: 'utf8' }),
      );
      assert.deepEqual(parsed.ProgramArguments, [
        f.context.node,
        f.context.worker,
        f.root,
        f.policy.binding,
      ]);
      assert.equal(parsed.RunAtLoad, true);
      assert.equal(parsed.KeepAlive, false);
    }
    const removed = await f.apply(false);
    for (const file of files) await assert.rejects(fs.lstat(file), { code: 'ENOENT' });
    const restore = await planManagedRestore(removed.backup, f.root);
    await applyManagedPlan(
      restore,
      () => planManagedRestore(removed.backup, f.root),
      restore.revision,
    );
    assert.equal((await historyStartupStatus(f.root, f.context)).installed, true);
  });

test('startup preserves foreign files, owned external edits and stale previews', async (t) => {
  const f = await fixture(t);
  const { files } = startupDefinition(f.root, f.policy.binding, f.context);
  await fs.mkdir(path.dirname(files[0].file), { recursive: true });
  await fs.writeFile(files[0].file, 'foreign service', { mode: 0o600 });
  const foreign = await f.plan();
  assert.equal(foreign.plan.blocked, true);
  await assert.rejects(applyHistoryStartup(foreign, foreign.plan.revision), /blocked/);
  assert.equal(await fs.readFile(files[0].file, 'utf8'), 'foreign service');
  await fs.unlink(files[0].file);
  const stale = await f.plan();
  await writeBackground(f.root, 'policy', { ...f.policy, interval: 6 });
  await assert.rejects(applyHistoryStartup(stale, stale.plan.revision), /changed since preview/);
  await f.apply();
  await fs.appendFile(files[0].file, '\nexternal edit');
  assert.equal((await f.plan(false)).plan.blocked, true);
  assert.equal((await historyStartupStatus(f.root, f.context)).state, 'needs-review');
});

test('startup rejects foreign symbolic links, invalid ownership and unsupported environments without touching their targets', async (t) => {
  const f = await fixture(t);
  const { files } = startupDefinition(f.root, f.policy.binding, f.context);
  const foreign = path.join(f.temporary, 'private-file');
  await fs.writeFile(foreign, 'do not change');
  await fs.mkdir(path.dirname(files[0].file), { recursive: true });
  await fs.symlink(foreign, files[0].file);
  assert.equal((await f.plan()).plan.blocked, true);
  assert.equal(await fs.readFile(foreign, 'utf8'), 'do not change');
  await fs.unlink(files[0].file);
  await f.apply();
  await fs.writeFile(path.join(f.root, 'state/history/startup.json'), '{broken');
  assert.equal((await historyStartupStatus(f.root, f.context)).state, 'needs-review');
  await assert.rejects(f.plan(false), /ownership is invalid/);
  assert.equal(
    (await historyStartupStatus(f.root, { ...f.context, platform: 'win32' })).supported,
    false,
  );
});

test('startup syntax escapes XML, quotes, systemd substitutions and rejects control characters', () => {
  const context = {
    platform: 'linux',
    home: '/home/example',
    configHome: '/home/example/config',
    node: '/runtime/node',
    worker: '/apps/a $NAME %n "quoted"/history-login.js',
  };
  const unit = startupDefinition('/hub with spaces', '1:2', context).files[0].content;
  assert.ok(unit.includes('$$NAME %%n \\"quoted\\"'));
  assert.ok(unit.includes('"/hub with spaces" "1:2"'));
  const plist = startupDefinition('/hub & <value>', '1:2', { ...context, platform: 'darwin' })
    .files[0].content;
  assert.ok(plist.includes('/hub &amp; &lt;value&gt;'));
  assert.throws(
    () => startupDefinition('/hub\nExecStart=bad', '1:2', context),
    /absolute local paths/,
  );
  assert.throws(() => startupDefinition('/hub', 'invalid', context), /binding/);
});

test('the login entry point resumes the saved selection and exits cooperatively, while stopped/replaced/invalid controls never resume', async (t) => {
  const f = await fixture(t);
  const run = () =>
    spawn(process.execPath, [f.context.worker, f.root, f.policy.binding], { stdio: 'ignore' });
  const worker = run();
  try {
    for (let i = 0; i < 200 && !(await readHistory(f.root)).chats.length; i++) await delay(25);
    assert.equal((await readHistory(f.root)).chats.length, 1);
    await fs.appendFile(
      f.file,
      f.encode([{ type: 'user', message: { role: 'user', content: 'after login sentinel' } }]),
    );
    for (let i = 0; i < 300 && (await readHistory(f.root)).chats[0].events !== 5; i++)
      await delay(25);
    assert.equal((await readHistory(f.root)).chats[0].events, 5);
    const exited = once(worker, 'exit');
    await requestBackgroundStop(f.root);
    await exited;
    const catalog = await fs.readFile(path.join(f.root, 'state/history/catalog.json'));
    assert.equal((await once(run(), 'exit'))[0], 0);
    await fs.writeFile(await backgroundFile(f.root, 'stop'), 'broken control');
    assert.equal((await once(run(), 'exit'))[0], 0);
    assert.deepEqual(await fs.readFile(path.join(f.root, 'state/history/catalog.json')), catalog);
    const wrongBinding = spawn(process.execPath, [f.context.worker, f.root, '0:0'], {
      stdio: 'ignore',
    });
    assert.equal((await once(wrongBinding, 'exit'))[0], 0);
    assert.equal(await backgroundBinding(f.root), f.policy.binding);
  } finally {
    if (worker.exitCode === null && worker.signalCode === null) {
      const exited = once(worker, 'exit');
      worker.kill('SIGTERM');
      await exited;
    }
  }
});
