import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { copyArtifact, inspectArtifact, sameArtifact } from '../dist/shared/artifacts.js';

test('directory recovery copies preserve nested symlink modes under a restrictive umask without changing targets', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ahub-link-modes-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const source = path.join(directory, 'source');
  const copy = path.join(directory, 'copy');
  const target = path.join(directory, 'target.txt');
  await fs.mkdir(source);
  await fs.writeFile(target, 'Retain target bytes and permissions.', { mode: 0o640 });
  await fs.symlink('../target.txt', path.join(source, 'reference'));
  if (process.platform === 'darwin') await fs.lchmod(path.join(source, 'reference'), 0o755);
  const before = await inspectArtifact(source);
  const targetBefore = await inspectArtifact(target);
  const previous = process.umask(0o077);
  try {
    await copyArtifact(source, copy);
  } finally {
    process.umask(previous);
  }
  assert.equal((await inspectArtifact(copy)).fingerprint, before.fingerprint);
  assert.equal(sameArtifact(before, await inspectArtifact(source)), true);
  assert.equal(sameArtifact(targetBefore, await inspectArtifact(target)), true);
  assert.equal(await fs.readlink(path.join(copy, 'reference')), '../target.txt');
});
