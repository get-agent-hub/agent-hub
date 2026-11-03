import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ahub-install-'));
try {
  const npm = process.env.npm_execpath;
  if (!npm) throw new Error('Run this installer through npm run install:global.');
  const [archive] = JSON.parse(
    execFileSync(
      process.execPath,
      [npm, 'pack', '--ignore-scripts', '--json', '--pack-destination', directory],
      { encoding: 'utf8' },
    ),
  );
  execFileSync(
    process.execPath,
    [npm, 'install', '--global', '--no-audit', '--no-fund', path.join(directory, archive.filename)],
    { stdio: 'inherit' },
  );
  console.log(
    'Installed a standalone package copy. Run ahub quick --interactive from any directory.',
  );
} finally {
  await fs.rm(directory, { recursive: true, force: true });
}
