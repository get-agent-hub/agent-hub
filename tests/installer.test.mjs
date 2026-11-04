import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

async function fixture(t, options = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ahub-installer-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const log = path.join(root, 'calls.jsonl');
  const stub = `
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.FIXTURE_LOG, JSON.stringify(args) + '\\n');
if (args[0] === 'pack') {
  const directory = args[args.indexOf('--pack-destination') + 1];
  fs.writeFileSync(path.join(directory, 'fixture.tgz'), 'fixture archive');
  const archive = { filename: 'fixture.tgz' };
  console.log(JSON.stringify(process.env.FIXTURE_REPLY === 'object' ? archive : [archive]));
} else if (args[0] === 'install') {
  if (!fs.existsSync(args.at(-1))) process.exit(9);
  if (process.env.FIXTURE_FAIL) process.exit(7);
} else process.exit(10);
`;
  const npmCli = path.join(root, options.fallback ? 'cli.js' : 'npm-cli.js');
  await fs.writeFile(npmCli, options.fallback ? "throw new Error('Wrong package manager');" : stub);
  if (options.fallback) {
    await fs.writeFile(path.join(root, 'npm'), `#!${process.execPath}\n${stub}`, { mode: 0o755 });
  }
  const result = spawnSync(process.execPath, ['scripts/install-global.mjs'], {
    encoding: 'utf8',
    env: {
      ...process.env,
      npm_execpath: npmCli,
      PATH: [root, process.env.PATH].join(path.delimiter),
      FIXTURE_LOG: log,
      FIXTURE_REPLY: options.reply ?? 'array',
      FIXTURE_FAIL: options.fail ? '1' : '',
    },
  });
  const calls = (await fs.readFile(log, 'utf8')).trim().split('\n').map(JSON.parse);
  const packedDirectory = calls[0][calls[0].indexOf('--pack-destination') + 1];
  const cache = calls[0][calls[0].indexOf('--cache') + 1];
  assert.equal(cache, path.join(packedDirectory, 'npm-cache'));
  assert.equal(calls[1][calls[1].indexOf('--cache') + 1], cache);
  assert.equal(calls[1].at(-1), path.join(packedDirectory, 'fixture.tgz'));
  await assert.rejects(fs.access(packedDirectory), { code: 'ENOENT' });
  return result;
}

for (const reply of ['array', 'object']) {
  test(`installer accepts npm's ${reply} pack metadata and cleans its isolated cache`, async (t) => {
    const result = await fixture(t, { reply });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Run ahub quick from any directory/);
  });
}

test('installer cleans temporary archive/cache after an install failure', async (t) => {
  const result = await fixture(t, { fail: true });
  assert.notEqual(result.status, 0);
  assert.doesNotMatch(result.stdout, /Installed a standalone/);
});

test('a generic cli.js from another package manager falls back to npm', async (t) => {
  const result = await fixture(t, { fallback: true });
  assert.equal(result.status, 0, result.stderr);
});
