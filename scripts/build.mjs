import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
// Renamed source modules must not survive as stale runnable files in a package.
await fs.rm(new URL('../dist/', import.meta.url), { recursive: true, force: true });
const compiler = createRequire(import.meta.url).resolve('typescript/bin/tsc');
const result = spawnSync(process.execPath, [compiler, '-p', 'tsconfig.json'], {
  cwd: root,
  stdio: 'inherit',
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
