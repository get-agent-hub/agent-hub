import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { discoverMemory } from '../dist/core/memory/discovery.js';
import { planMemoryOnboarding } from '../dist/core/memory/onboarding.js';
import { memoryLocation, planMemoryProject } from '../dist/core/projects/memory-bindings.js';

import { queryMemory } from '../dist/core/memory/store.js';
import {
  applyManagedPlan,
  planManagedRestore,
  publicManagedPlan,
} from '../dist/core/recovery/managed-plan.js';

import { readAutomation } from '../dist/core/memory/automation/config.js';
import { syncNativeAutomatically } from '../dist/core/memory/automation/sync.js';
import { getMemory } from '../dist/core/memory/records.js';
import { createMemorySession } from '../dist/core/memory/session.js';
import { startUiServer } from '../dist/ui/server.js';

const exec = promisify(execFile);
const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
const at = '2026-11-03T00:00:00.000Z';
async function apply(build) {
  const plan = await build();
  assert.equal(plan.blocked, false);
  return applyManagedPlan(plan, build, plan.revision);
}
async function fixture(t) {
  const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'ahub-onboard-')));
  const root = path.join(directory, 'hub');
  const workspace = path.join(directory, 'project-a');
  const other = path.join(directory, 'project-b');
  const claude = path.join(directory, 'claude');
  const codex = path.join(directory, 'codex');
  const dsh = path.join(directory, 'dsh');
  for (const folder of [root, workspace, other, claude, codex, dsh]) await fs.mkdir(folder);
  await fs.writeFile(path.join(root, 'hub.yaml'), 'version: 1\n');
  await exec('git', ['init', '-q', workspace]);
  await exec('git', ['init', '-q', other]);
  const overrides = { CLAUDE_CONFIG_DIR: claude, CODEX_HOME: codex, DSH_HOME: dsh };
  const previous = Object.fromEntries(Object.keys(overrides).map((key) => [key, process.env[key]]));
  Object.assign(process.env, overrides);
  t.after(async () => {
    for (const [key, value] of Object.entries(previous))
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    await fs.rm(directory, { recursive: true, force: true });
  });
  await apply(() => planMemoryProject(root, 'demo', workspace));
  const collection = path.join(claude, 'projects', 'ambiguous-folder-name');
  const native = path.join(collection, 'memory');
  await fs.mkdir(native, { recursive: true });
  await fs.writeFile(
    path.join(collection, 'session.jsonl'),
    JSON.stringify({ cwd: workspace, message: 'PRIVATE_CONVERSATION_NEVER_RETURNED' }) + '\n',
  );
  await fs.writeFile(path.join(native, 'rule.md'), '# API rule\nUse idempotency keys.\n');
  return {
    directory,
    root,
    workspace,
    other,
    claude,
    codex,
    dsh,
    native,
    collection,
    context: { root, selector: { workspace } },
    records: async () =>
      (await queryMemory([await memoryLocation(root, { workspace })], '', 100)).results,
  };
}

test('discovery uses cwd evidence, reports unsupported stores and never returns conversation or note bodies', async (t) => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.codex, 'memories_1.sqlite'), 'PRIVATE_DATABASE_NOT_READ');
  const unknown = path.join(f.claude, 'projects', 'encoded-project-name', 'memory');
  await fs.mkdir(unknown, { recursive: true });
  await fs.writeFile(path.join(unknown, 'MEMORY.md'), '# Memory\nUnknown project fact.');
  const report = await discoverMemory(f.root, f.workspace);
  const known = report.sources.find((source) => source.path === f.native);
  assert.equal(known.project, f.workspace);
  assert.match(known.evidence, /cwd metadata/);
  assert.equal(report.sources.find((source) => source.path === unknown).project, null);
  assert.equal(
    report.sources.find((source) => source.path.endsWith('.sqlite')).format,
    'unsupported',
  );
  assert.equal(JSON.stringify(report).includes('PRIVATE_'), false);
  assert.equal(JSON.stringify(report).includes('idempotency'), false);
  assert.equal((await f.records()).length, 0);
});

test('one-time onboarding imports existing memory, preserves originals and is idempotent without enabling hooks', async (t) => {
  const f = await fixture(t);
  const original = await fs.readFile(path.join(f.native, 'rule.md'), 'utf8');
  const build = () => planMemoryOnboarding(f.root, f.workspace, at);
  const preview = await build();
  assert.equal((await f.records()).length, 0);
  assert.equal(JSON.stringify(publicManagedPlan(preview)).includes('Use idempotency keys.'), false);
  await apply(build);
  assert.equal((await f.records()).length, 1);
  assert.equal((await build()).requests.length, 0);
  assert.equal((await readAutomation(f.root, f.workspace)).policy.enabled, false);
  assert.equal(await fs.readFile(path.join(f.native, 'rule.md'), 'utf8'), original);
  await assert.rejects(fs.access(path.join(f.claude, 'settings.json')), { code: 'ENOENT' });
});

test('sources from explicitly shared checkout bindings belong to the same Hub project', async (t) => {
  const f = await fixture(t);
  await apply(() => planMemoryProject(f.root, 'demo', f.other));
  const report = await discoverMemory(f.root, f.other);
  assert.equal(report.sources.find((source) => source.path === f.native).projectId, 'demo');
  await apply(() => planMemoryOnboarding(f.root, f.other, at));
  assert.equal((await f.records()).length, 1);
});

test('follow policy, imported facts and bindings restore as one reviewed transaction', async (t) => {
  const f = await fixture(t);
  const result = await apply(() => planMemoryOnboarding(f.root, f.workspace, at, { follow: true }));
  const { policy } = await readAutomation(f.root, f.workspace);
  assert.equal(policy.enabled, true);
  assert.deepEqual(policy.native, [{ client: 'claude-code', directory: f.native }]);
  assert.equal((await syncNativeAutomatically(f.root, f.workspace)).changedPaths, 0);
  await apply(() => planManagedRestore(result.backup, f.root));
  assert.equal((await f.records()).length, 0);
  assert.equal((await readAutomation(f.root, f.workspace)).policy.enabled, false);
});

test('follow imports later source updates and preserves a single canonical record', async (t) => {
  const f = await fixture(t);
  await apply(() => planMemoryOnboarding(f.root, f.workspace, at, { follow: true }));
  const id = (await f.records())[0].id;
  await fs.writeFile(
    path.join(f.native, 'rule.md'),
    '# Updated API title\nUse a verified stable retry key.\n',
  );
  await syncNativeAutomatically(f.root, f.workspace);
  assert.equal((await f.records()).length, 1);
  assert.equal((await getMemory(f.context, id)).body, 'Use a verified stable retry key.');
});

test('mixed MEMORY.md imports facts and code while pure local navigation is omitted', async (t) => {
  const f = await fixture(t);
  const note =
    '# Memory\n- [API rule](rule.md)\n\n## Actual decision\nRetain this inline decision.\n\n## Example\n~~~markdown\n## Example heading\n[API rule](rule.md)\n~~~\n';
  await fs.writeFile(path.join(f.native, 'MEMORY.md'), note);
  await apply(() => planMemoryOnboarding(f.root, f.workspace, at, { follow: true }));
  const records = await f.records();
  assert.equal(records.length, 3);
  assert.equal(
    records.some((record) => record.title === 'Actual decision'),
    true,
  );
  assert.match(
    (await getMemory(f.context, records.find((record) => record.title === 'Example').id)).body,
    /## Example heading/,
  );
  assert.equal(await fs.readFile(path.join(f.native, 'MEMORY.md'), 'utf8'), note);
  await fs.writeFile(path.join(f.native, 'MEMORY.md'), '# Memory\n- [API rule](rule.md)\n');
  await syncNativeAutomatically(f.root, f.workspace);
  assert.equal(
    (await f.records()).length,
    3,
    'Deleting source sections never deletes learned facts',
  );
});

test('unresolved sources require explicit selection and known foreign/unsupported sources cannot be imported', async (t) => {
  const f = await fixture(t);
  await fs.rm(f.collection, { recursive: true });
  const global = path.join(f.codex, 'memories');
  await fs.mkdir(global);
  await fs.writeFile(path.join(global, 'MEMORY.md'), '# Global note\nSelected knowledge.');
  await fs.writeFile(path.join(f.codex, 'memories_1.sqlite'), 'not read');
  const foreign = path.join(f.claude, 'projects', 'foreign');
  await fs.mkdir(path.join(foreign, 'memory'), { recursive: true });
  await fs.writeFile(path.join(foreign, 'one.jsonl'), JSON.stringify({ cwd: f.other }) + '\n');
  const report = await discoverMemory(f.root, f.workspace);
  await assert.rejects(planMemoryOnboarding(f.root, f.workspace, at), /No project-matched/);
  await assert.rejects(
    planMemoryOnboarding(f.root, f.workspace, at, {
      sources: [report.sources.find((source) => source.format === 'unsupported').id],
    }),
    /unsupported/,
  );
  await assert.rejects(
    planMemoryOnboarding(f.root, f.workspace, at, {
      sources: [report.sources.find((source) => source.project === f.other).id],
    }),
    /another checkout/,
  );
  const chosen = report.sources.find((source) => source.path === global);
  const plan = await planMemoryOnboarding(f.root, f.workspace, at, { sources: [chosen.id] });
  assert.match(plan.rows.find((row) => row.name === chosen.id).note, /Explicitly assign/);
  await apply(() => planMemoryOnboarding(f.root, f.workspace, at, { sources: [chosen.id] }));
  assert.equal((await f.records()).length, 1);
});

test('ambiguous metadata and symlinked project directories never acquire an automatic project mapping', async (t) => {
  const f = await fixture(t);
  await fs.writeFile(
    path.join(f.collection, 'other.jsonl'),
    JSON.stringify({ cwd: f.other }) + '\n',
  );
  await fs.symlink(f.codex, path.join(f.workspace, '.codex'), 'dir');
  await fs.mkdir(path.join(f.codex, 'memory'));
  const report = await discoverMemory(f.root, f.workspace);
  assert.equal(report.sources.find((source) => source.path === f.native).project, null);
  assert.equal(
    report.sources.find((source) => source.path === path.join(f.codex, 'memory')).project,
    null,
  );
});

test('source edits invalidate an onboarding preview before policy or facts are changed', async (t) => {
  const f = await fixture(t);
  const session = createMemorySession({ root: f.root, workspace: f.workspace, writable: true });
  const source = (await session.discover()).sources.find((source) => source.path === f.native);
  const preview = await session.previewOnboarding([source.id], true);
  await fs.writeFile(path.join(f.native, 'rule.md'), '# API\nExternal change.');
  await assert.rejects(session.apply(preview.id, preview.revision), /Inputs changed/);
  assert.equal((await f.records()).length, 0);
  assert.equal((await readAutomation(f.root, f.workspace)).policy.enabled, false);
  await assert.rejects(
    createMemorySession({ root: f.root, workspace: f.workspace }).previewOnboarding(
      [source.id],
      true,
    ),
    /Writes are not enabled/,
  );
});

test('CLI discovers and replays the exact onboarding plan', async (t) => {
  const f = await fixture(t);
  const env = { ...process.env, AGENT_HUB_HOME: f.root };
  const { stdout } = await exec(
    process.execPath,
    [cli, 'memory', 'discover', '--workspace', f.workspace, '--json'],
    { env },
  );
  const source = JSON.parse(stdout).sources.find((source) => source.path === f.native);
  const preview = JSON.parse(
    (
      await exec(
        process.execPath,
        [
          cli,
          'memory',
          'onboard',
          '--workspace',
          f.workspace,
          '--source',
          source.id,
          '--follow',
          '--dry-run',
          '--json',
        ],
        { env },
      )
    ).stdout,
  );
  await exec('sh', ['-c', preview.commands.apply], { env });
  assert.equal((await f.records()).length, 1);
  assert.equal((await readAutomation(f.root, f.workspace)).policy.native[0].directory, f.native);
});

test('UI discovery is scoped and onboarding previews require the UI token and reject workspace injection', async (t) => {
  const f = await fixture(t);
  const ui = await startUiServer({
    port: 0,
    cwd: f.workspace,
    services: {
      state: async () => ({}),
      memory: createMemorySession({ root: f.root, workspace: f.workspace, writable: true }),
    },
  });
  t.after(() => ui.close());
  const report = await (await fetch(ui.url + '/api/memory/discovery')).json();
  assert.equal(report.workspace, f.workspace);
  const source = report.sources.find((source) => source.path === f.native);
  const token = (await (await fetch(ui.url + '/api/state')).json()).token;
  const post = (route, body, key = token) =>
    fetch(ui.url + route, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Agent-Hub-Token': key },
      body: JSON.stringify(body),
    });
  const input = { sources: [source.id], follow: true };
  assert.equal((await post('/api/memory/onboarding/preview', input, 'wrong')).status, 403);
  assert.equal(
    (await post('/api/memory/onboarding/preview', { ...input, workspace: f.other })).status,
    400,
  );
  const response = await post('/api/memory/onboarding/preview', input);
  assert.equal(response.status, 200);
  const preview = await response.json();
  assert.equal((await f.records()).length, 0);
  const receipt = { id: preview.id, revision: preview.revision };
  assert.equal((await post('/api/memory/apply', receipt)).status, 200);
  assert.equal((await post('/api/memory/apply', receipt)).status, 409);
  assert.equal((await f.records()).length, 1);
});
