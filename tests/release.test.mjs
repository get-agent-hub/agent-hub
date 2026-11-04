import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ahub-release-tag-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'scripts'));
  await fs.copyFile(
    'scripts/check-release-tag.mjs',
    path.join(root, 'scripts/check-release-tag.mjs'),
  );
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ version: '0.1.0-beta.1' }));
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { stdio: 'pipe' });
  git('init', '-q');
  git('add', '.');
  git(
    '-c',
    'user.name=Fixture',
    '-c',
    'user.email=fixture@example.com',
    'commit',
    '-qm',
    'fixture',
  );
  git('tag', 'v0.1.0-beta.1');
  const check = (tag) =>
    spawnSync(process.execPath, ['scripts/check-release-tag.mjs'], {
      cwd: root,
      env: { ...process.env, RELEASE_TAG: tag },
      encoding: 'utf8',
    });
  return { root, git, check };
}

test('release requires a real version tag matching the package and checked-out commit', async (t) => {
  const f = await fixture(t);
  assert.equal(f.check('v0.1.0-beta.1').status, 0);
  for (const tag of ['master', '', 'v0.2.0', '--help'])
    assert.notEqual(f.check(tag).status, 0, tag);
  await fs.writeFile(path.join(f.root, 'change.txt'), 'later commit');
  f.git('add', '.');
  f.git(
    '-c',
    'user.name=Fixture',
    '-c',
    'user.email=fixture@example.com',
    'commit',
    '-qm',
    'later',
  );
  const stale = f.check('v0.1.0-beta.1');
  assert.notEqual(stale.status, 0);
  assert.match(stale.stderr, /Checkout must match/);
});

test('an untagged version cannot become a release implicitly', async (t) => {
  const f = await fixture(t);
  f.git('tag', '-d', 'v0.1.0-beta.1');
  assert.notEqual(f.check('v0.1.0-beta.1').status, 0);
});
