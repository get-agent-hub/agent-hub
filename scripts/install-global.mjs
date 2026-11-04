import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ahub-install-'));
try {
  const npmExecPath = process.env.npm_execpath;
  if (!npmExecPath) throw new Error('Run this installer through npm run install:global.');

  // Other package managers expose their own CLI through npm_execpath.
  // Generic cli.js filenames do not establish that the executable is npm.
  const npmCliName = path.basename(npmExecPath);
  const isNpmCli = /^npm(?:-cli)?\.js$/.test(npmCliName);
  // Isolated cache: keeps the installer working even when ~/.npm has
  // root-owned files from older npm/sudo usage (EPERM on _cacache).
  const cache = path.join(directory, 'npm-cache');
  const runNpm = (args, options = {}) =>
    isNpmCli
      ? execFileSync(process.execPath, [npmExecPath, ...args], options)
      : execFileSync('npm', args, { shell: process.platform === 'win32', ...options });

  const packJson = runNpm([
    'pack',
    '--ignore-scripts',
    '--json',
    '--pack-destination',
    directory,
    '--cache',
    cache,
  ]).toString('utf8');
  const parsed = JSON.parse(packJson);
  const archive = Array.isArray(parsed) ? parsed[0] : parsed;
  if (!archive?.filename) {
    throw new Error(`Unexpected npm pack output: ${packJson.slice(0, 200)}`);
  }

  runNpm(
    [
      'install',
      '--global',
      '--no-audit',
      '--no-fund',
      '--cache',
      cache,
      path.join(directory, archive.filename),
    ],
    { stdio: 'inherit' },
  );
  console.log('Installed a standalone package copy. Run ahub quick from any directory.');
} finally {
  await fs.rm(directory, { recursive: true, force: true });
}
