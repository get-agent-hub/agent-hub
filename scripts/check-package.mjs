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
  'dist/core/history/ingest.js',
  'dist/core/history/raw.js',
  'dist/core/history/connection.js',
  'dist/mcp/history.js',
  'dist/ui/routes/history.js',
  'ui/app/features/history.js',
  'ui/app/entities/history-conversation.js',
  'docs/HISTORY.md',
  'docs/UI.md',
  'dist/shared/runtime.js',
  'dist/workers/doctor.js',
  'dist/core/mcp/sync/plan.js',
  'dist/core/setup/quick/apply.js',
  'dist/ui/routes/discovery.js',
  'dist/ui/routes/memory.js',
  'dist/ui/session.js',
  'npm-shrinkwrap.json',
  'dist/core/recovery/workflow-recovery.js',
  'dist/core/projects/disconnect.js',
  'dist/core/setup/quick.js',
  'dist/commands/quick.js',
  'ui/app/features/quick.js',
  'docs/README.md',
  'docs/QUICKSTART.md',
  'docs/CLI.md',
  'docs/RELEASE.md',
  'dist/integrations/dsh-memory.js',
  'dist/core/memory/discovery.js',
  'dist/core/memory/onboarding.js',
  'dist/commands/memory-onboarding.js',
  'ui/app/index.html',
  'ui/app/app.js',
  'ui/app/shared/html.js',
  'ui/app/entities/health.js',
  'ui/app/entities/resource.js',
  'ui/app/features/content.js',
  'ui/app/features/memory.js',
  'ui/app/features/projects.js',
  'dist/core/projects/discovery.js',
  'dist/ui/project-discovery.js',
  'dist/adapters/claude-sessions.js',
  'ui/app/base.css',
  'ui/app/app.css',
  'ui/app/shared/navigation.js',
  'ui/app/shared/en.js',
  'ui/app/shared/view.js',
  'ui/app/pages/overview.js',
  'ui/app/pages/sources.js',
  'ui/app/pages/resources.js',
  'ui/app/features/import-mcp.js',
  'ui/app/features/sync-mcp.js',
  'ui/app/features/check-mcp.js',
  'ui/app/styles/primitives.css',
  'ui/app/styles/tables.css',
  'ui/app/styles/resources.css',
  'ui/app/styles/dialogs.css',
  'ui/app/styles/history.css',
  'ui/app/styles/shell.css',
  'ui/app/styles/pages.css',
  'ui/app/styles/responsive.css',

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
for (const file of files) {
  assert.ok(!/^dist\/core\/[^/]+\.js(?:\.map)?$/.test(file), `Stale flat core module: ${file}`);
  assert.ok(
    /^(dist\/|ui\/app\/|docs\/(README|CLI|RELEASE|QUICKSTART|CONTENT|MEMORY|AUTOMATION|WORKING_GUIDE|RECOVERY|DESIGN|HISTORY|UI)\.md$|README\.md$|CHANGELOG\.md$|SECURITY\.md$|LICENSE$|package\.json$|npm-shrinkwrap\.json$)/.test(
      file,
    ),
    `Unexpected package file: ${file}`,
  );
}
console.log(
  `Package verified: ${files.size} files, ${archive.unpackedSize} bytes unpacked; source tests, local state and fixtures excluded.`,
);
