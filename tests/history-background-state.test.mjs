import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { configureBackground, backgroundStatus } from '../dist/core/history/background.js';
import {
  backgroundFile,
  claimBackground,
  readBackgroundLease,
} from '../dist/core/history/background-state.js';
import { historyFixture } from './helpers/history.mjs';

test('a disappearing process lease remains a valid observation and the next status becomes stopped', async (t) => {
  const f = await historyFixture(t);
  const policy = await configureBackground(f.root, [f.source], 5);
  const release = await claimBackground(f.root, policy.id);
  t.after(release);
  const file = await backgroundFile(f.root, 'lease');
  const readFile = fs.readFile.bind(fs);
  let removed = false;
  t.mock.method(fs, 'readFile', async (target, ...options) => {
    const content = await readFile(target, ...options);
    if (target === file && !removed) {
      removed = true;
      await fs.unlink(file); // The worker exits after the read but before a metadata lookup.
    }
    return content;
  });
  assert.deepEqual(await readBackgroundLease(f.root), { id: policy.id, pid: process.pid });
  assert.equal(removed, true);
  const status = await backgroundStatus(f.root);
  assert.equal(status.running, false);
  assert.equal(status.state, 'stopped');
  assert.equal(status.enabled, true, 'process absence does not rewrite the selected policy');
});

test('background control reads still reject corrupt leases and symlink redirection', async (t) => {
  const f = await historyFixture(t);
  await configureBackground(f.root, [f.source], 5);
  const file = await backgroundFile(f.root, 'lease');
  assert.equal(await readBackgroundLease(f.root), null);
  await fs.writeFile(file, 'invalid');
  await assert.rejects(readBackgroundLease(f.root), /metadata is invalid/);
  await fs.unlink(file);
  const outside = path.join(f.temporary, 'unrelated.json');
  await fs.writeFile(outside, 'unrelated private fixture');
  await fs.symlink(outside, file);
  await assert.rejects(readBackgroundLease(f.root), /symbolic link/);
  assert.equal(await fs.readFile(outside, 'utf8'), 'unrelated private fixture');
});
