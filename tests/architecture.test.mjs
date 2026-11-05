import assert from 'node:assert/strict';
import test from 'node:test';
import { inspectArchitecture } from '../scripts/architecture/inspect.mjs';

const inspect = (files) => inspectArchitecture(new Map(Object.entries(files)));

test('architecture resolves nested source paths instead of matching import spelling', () => {
  const report = inspect({
    'src/core/memory/automation/use.ts': "import '../../../ui/server.js';",
    'src/ui/server.ts': 'export const server = true;',
  });
  assert.match(report.issues.join('\n'), /Forbidden dependency/);
});

test('shared modules cannot hide a feature dependency behind a type import', () => {
  const report = inspect({
    'src/shared/file.ts': "import type { Plan } from '../core/setup/plan.js';",
    'src/core/setup/plan.ts': 'export interface Plan {}',
  });
  assert.match(report.issues.join('\n'), /Forbidden dependency/);
});

test('architecture detects runtime cycles through re-exports and dynamic imports', () => {
  const report = inspect({
    'src/core/memory/a.ts': "export { b } from './b.js';",
    'src/core/memory/b.ts': "export const b = () => import('./a.js');",
  });
  assert.match(report.issues.join('\n'), /Runtime import cycle/);
});

test('type-only relationships do not create runtime cycles', () => {
  const report = inspect({
    'src/contracts/a.ts': "import { type B } from './b.js'; export type A = B;",
    'src/contracts/b.ts': "export { type A as B } from './a.js';",
  });
  assert.deepEqual(report.issues, []);
});

test('unknown relative modules fail before a stale dist file can hide a rename', () => {
  const report = inspect({ 'src/core/memory/a.ts': "import './removed.js';" });
  assert.match(report.issues.join('\n'), /Unresolved import/);
});

test('only the UI launcher command can compose the HTTP interface', () => {
  assert.deepEqual(
    inspect({
      'src/commands/ui.ts': "import '../ui/server.js';",
      'src/ui/server.ts': '',
    }).issues,
    [],
  );
  assert.match(
    inspect({
      'src/commands/sync.ts': "import '../ui/server.js';",
      'src/ui/server.ts': '',
    }).issues.join('\n'),
    /Forbidden dependency/,
  );
});

test('browser modules cannot pull Node or backend code into the client', () => {
  const report = inspect({
    'ui/app/app.js': "import 'node:fs'; import '../../src/shared/file.js';",
    'src/shared/file.ts': '',
  });
  assert.equal(report.issues.length, 2);
});

test('adapters cannot grow dependencies on setup or recovery workflows', () => {
  const report = inspect({
    'src/adapters/client.ts': "import '../core/setup/plan.js';",
    'src/core/setup/plan.ts': '',
  });
  assert.match(report.issues.join('\n'), /unrelated workflows/);
});

test('browser slices depend downward and cannot reach across feature implementations', () => {
  for (const files of [
    { 'ui/app/shared/html.js': "import '../pages/overview.js';", 'ui/app/pages/overview.js': '' },
    {
      'ui/app/entities/chat.js': "import '../features/history.js';",
      'ui/app/features/history.js': '',
    },
    { 'ui/app/features/history.js': "import './memory.js';", 'ui/app/features/memory.js': '' },
  ])
    assert.match(inspect(files).issues.join('\n'), /Forbidden browser dependency/);
  assert.deepEqual(
    inspect({
      'ui/app/app.js': "import './pages/overview.js';",
      'ui/app/pages/overview.js': "import '../entities/chat.js';",
      'ui/app/entities/chat.js': "import '../shared/html.js';",
      'ui/app/shared/html.js': '',
    }).issues,
    [],
  );
});
