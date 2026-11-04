import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const [archive] = JSON.parse(
  execFileSync(
    process.execPath,
    [process.env.npm_execpath, 'pack', '--dry-run', '--ignore-scripts', '--json'],
    { encoding: 'utf8' },
  ),
);
const files = new Set(archive.files.map((file) => file.path));
for (const required of [
  'dist/cli.js',
  'npm-shrinkwrap.json',
  'dist/core/workflow-recovery.js',
  'dist/core/project-disconnect.js',
  'dist/core/quick.js',
  'dist/commands/quick.js',
  'ui/app/quick.js',
  'docs/README.md',
  'docs/QUICKSTART.md',
  'docs/CLI.md',
  'docs/RELEASE.md',
  'dist/integrations/dsh-memory.js',
  'dist/core/memory-discovery.js',
  'dist/core/memory-onboarding.js',
  'dist/commands/memory-onboarding.js',
  'ui/app/index.html',
  'ui/app/app.js',
  'ui/app/html.js',
  'ui/app/health.js',
  'ui/app/content.js',
  'ui/app/memory.js',
  'ui/app/base.css',
  'docs/CONTENT.md',
  'docs/MEMORY.md',
  'docs/AUTOMATION.md',
  'docs/WORKING_GUIDE.md',
  'docs/RECOVERY.md',
  'docs/DESIGN.md',
  'LICENSE',
  'CHANGELOG.md',
  'SECURITY.md',
]) {
  assert.ok(files.has(required), `Package is missing ${required}`);
}
for (const file of files)
  assert.ok(
    /^(dist\/|ui\/app\/|docs\/(README|CLI|RELEASE|QUICKSTART|CONTENT|MEMORY|AUTOMATION|WORKING_GUIDE|RECOVERY|DESIGN)\.md$|README\.md$|CHANGELOG\.md$|SECURITY\.md$|LICENSE$|package\.json$|npm-shrinkwrap\.json$)/.test(
      file,
    ),
    `Unexpected package file: ${file}`,
  );
console.log(
  `Package verified: ${files.size} files, ${archive.unpackedSize} bytes unpacked; source tests, local state and fixtures excluded.`,
);
