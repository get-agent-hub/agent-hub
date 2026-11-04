import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
assert.equal(git('status', '--porcelain'), '', 'Prepare releases from a clean checkout.');
const metadata = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
assert.match(metadata.version, /^\d+\.\d+\.\d+(?:-[\w.-]+)?$/, 'Expected a release version.');
assert.ok(process.env.npm_execpath, 'Run through npm run release:prepare.');
const revision = git('rev-parse', 'HEAD');
const output = path.join(root, '.tmp', 'release', metadata.version);
await fs.mkdir(output, { recursive: true });

const [archive] = JSON.parse(
  execFileSync(
    process.execPath,
    [process.env.npm_execpath, 'pack', '--ignore-scripts', '--json', '--pack-destination', output],
    { cwd: root, encoding: 'utf8' },
  ),
);
const source = `agent-hub-source-${metadata.version}.zip`;
execFileSync('git', [
  '-C',
  root,
  'archive',
  '--format=zip',
  '--prefix=agent-hub/',
  `--output=${path.join(output, source)}`,
  revision,
]);
const files = await Promise.all(
  [archive.filename, source].map(async (name) => {
    const bytes = await fs.readFile(path.join(output, name));
    return { name, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length };
  }),
);
await fs.writeFile(
  path.join(output, 'SHA256SUMS'),
  files.map(({ name, sha256 }) => `${sha256}  ${name}\n`).join(''),
);
await fs.writeFile(
  path.join(output, 'release.json'),
  JSON.stringify(
    {
      version: metadata.version,
      revision,
      node: metadata.engines.node,
      files,
    },
    null,
    2,
  ) + '\n',
);
console.log(`Prepared ${metadata.version} from ${revision} in ${output}. Nothing published.`);
