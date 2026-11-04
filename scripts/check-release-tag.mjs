import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const tag = process.env.RELEASE_TAG;
assert.match(tag ?? '', /^v\d+\.\d+\.\d+(?:-[\w.-]+)?$/, 'Expected an existing version tag.');
assert.equal(tag, `v${version}`, 'Release tag must match package.json.');
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
assert.equal(
  git('rev-parse', '--verify', `refs/tags/${tag}^{commit}`),
  git('rev-parse', 'HEAD'),
  'Checkout must match the tagged commit.',
);
console.log(`Verified ${tag} at ${git('rev-parse', 'HEAD')}.`);
