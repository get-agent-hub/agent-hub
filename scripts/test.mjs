import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const files = readdirSync(new URL('../tests/', import.meta.url))
  .filter((name) => name.endsWith('.test.mjs'))
  .sort()
  .map((name) => `tests/${name}`);
const flags = process.argv.includes('--coverage')
  ? [
      '--experimental-test-coverage',
      '--test-coverage-include=dist/**',
      '--test-coverage-lines=80',
      '--test-coverage-branches=75',
      '--test-coverage-functions=80',
    ]
  : [];
const result = spawnSync(process.execPath, [...flags, '--test', ...files], {
  cwd: root,
  stdio: 'inherit',
});
if (result.error) {
  console.error('Could not start the test runner.');
  process.exitCode = 1;
} else process.exitCode = result.status ?? 1;
