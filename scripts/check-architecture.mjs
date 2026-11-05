import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectArchitecture } from './architecture/inspect.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const modules = new Map();
async function read(directory) {
  for (const entry of await fs.readdir(path.join(root, directory), { withFileTypes: true })) {
    const file = path.posix.join(directory, entry.name);
    if (entry.isDirectory()) await read(file);
    else if (/\.(ts|js)$/.test(file))
      modules.set(file, await fs.readFile(path.join(root, file), 'utf8'));
  }
}
await Promise.all([read('src'), read('ui/app')]);
const report = inspectArchitecture(modules);
if (report.issues.length) {
  for (const issue of report.issues) console.error(issue);
  process.exitCode = 1;
} else
  console.log(
    `Architecture verified: ${report.modules} modules, ${report.edges} imports, no forbidden dependencies or runtime cycles.`,
  );
