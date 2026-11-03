import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { memoryLocation, planMemoryProject } from '../dist/core/memory-projects.js';
import { decodeMemory, encodeMemory, queryMemory } from '../dist/core/memory-store.js';
import { getMemory, planMemoryMutation } from '../dist/core/memory.js';
import { createMemorySession } from '../dist/core/memory-session.js';
import { startUiServer } from '../dist/ui/server.js';
import { planReset, applyReset } from '../dist/core/reset.js';
import {
  applyManagedPlan,
  publicManagedPlan,
  planManagedRestore,
} from '../dist/core/managed-plan.js';

const exec = promisify(execFile);
const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
const at = '2026-11-03T10:00:00.000Z';
const later = '2026-11-03T10:01:00.000Z';

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ahub-memory-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const root = path.join(directory, 'hub');
  await fs.mkdir(root);
  await fs.writeFile(path.join(root, 'hub.yaml'), 'version: 1\n');
  const workspaces = [];
  for (const id of ['one', 'two']) {
    const workspace = path.join(directory, id);
    await fs.mkdir(workspace);
    await exec('git', ['init', '-q', workspace]);
    workspaces.push(workspace);
  }
  return { directory, root, workspaces, shared: { root, selector: { shared: true } } };
}

async function apply(build) {
  const plan = await build();
  return applyManagedPlan(plan, build, plan.revision);
}

function put(context, id = 'retry-rule', extra = {}) {
  return () =>
    planMemoryMutation(context, {
      operation: 'create',
      id,
      title: 'Retry requests safely',
      body: 'Use an idempotency key for retries.\n',
      at,
      ...extra,
    });
}

async function project(fixture, index = 0, id = 'demo') {
  const workspace = fixture.workspaces[index];
  await apply(() => planMemoryProject(fixture.root, id, workspace));
  return { root: fixture.root, selector: { workspace } };
}

test('memory preview writes nothing; create maintains a bounded owned index and keeps personal text', async (t) => {
  const f = await fixture(t);
  await fs.mkdir(path.join(f.root, 'memory'));
  await fs.writeFile(
    path.join(f.root, 'memory', 'MEMORY.md'),
    '# Personal index\nKeep this byte-for-byte.\n',
  );
  const build = put(f.shared);
  const plan = await build();
  assert.equal(plan.requests.length, 3);
  assert.equal(JSON.stringify(publicManagedPlan(plan)).includes('Use an idempotency key'), false);
  await assert.rejects(fs.access(path.join(f.root, 'memory', 'shared')));
  await assert.rejects(applyManagedPlan(plan, build), /requires --expect/);
  await apply(build);
  const record = await getMemory(f.shared, 'retry-rule');
  assert.equal(record.body, 'Use an idempotency key for retries.\n');
  assert.equal(record.created, at);
  assert.match(
    await fs.readFile(path.join(f.root, 'memory', 'MEMORY.md'), 'utf8'),
    /^# Personal index\nKeep this byte-for-byte\.\n<!-- agent-hub:memory-index:start -->/,
  );
  if (process.platform !== 'win32')
    assert.equal(
      (await fs.stat(path.join(f.root, 'memory', 'shared', 'records', 'retry-rule.md'))).mode &
        0o777,
      0o600,
    );
});

test('project binding is explicit, idempotent and does not reassign another project', async (t) => {
  const f = await fixture(t);
  await assert.rejects(memoryLocation(f.root, { workspace: f.workspaces[0] }), /no memory binding/);
  const a = await project(f);
  assert.equal((await planMemoryProject(f.root, 'demo', f.workspaces[0])).requests.length, 0);
  assert.equal((await planMemoryProject(f.root, 'other', f.workspaces[0])).blocked, true);
  await project(f, 1, 'demo');
  await apply(put(a));
  assert.equal(
    (await getMemory({ root: f.root, selector: { workspace: f.workspaces[1] } }, 'retry-rule'))
      .scope,
    'project:demo',
  );
});

test('a replacement repository at a previously bound path requires an explicit reviewed rebind', async (t) => {
  const f = await fixture(t);
  const context = await project(f);
  await apply(put(context));
  await fs.rm(path.join(f.workspaces[0], '.git'), { recursive: true });
  await exec('git', ['init', '-q', f.workspaces[0]]);
  await assert.rejects(getMemory(context, 'retry-rule'), /identity changed/);
  assert.equal((await planMemoryProject(f.root, 'demo', f.workspaces[0])).blocked, true);
  assert.equal((await planMemoryProject(f.root, 'other', f.workspaces[0], true)).blocked, true);
  await apply(() => planMemoryProject(f.root, 'demo', f.workspaces[0], true));
  assert.equal((await getMemory(context, 'retry-rule')).scope, 'project:demo');
});

test('scoped search excludes all other project records and shared knowledge unless selected', async (t) => {
  const f = await fixture(t);
  const a = await project(f, 0, 'one');
  const b = await project(f, 1, 'two');
  await apply(put(a, 'visible'));
  await apply(put(b, 'private', { title: 'Private project title' }));
  await apply(put(f.shared, 'shared'));
  const result = await queryMemory([await memoryLocation(a.root, a.selector)], 'idempotency');
  assert.deepEqual(
    result.results.map((record) => record.id),
    ['visible'],
  );
  assert.equal(JSON.stringify(result).includes('Private project'), false);
  await assert.rejects(getMemory(a, 'private'), /not found/);
  const session = createMemorySession({ root: f.root, workspace: f.workspaces[0] });
  await assert.rejects(session.list('shared'), /not enabled/);
  await assert.rejects(session.list('project:two'), /Choose project or shared/);
});

test('update/delete require a record revision; stale editor changes invalidate a whole reviewed plan', async (t) => {
  const f = await fixture(t);
  await apply(put(f.shared));
  await assert.rejects(
    planMemoryMutation(f.shared, {
      operation: 'update',
      id: 'retry-rule',
      at: later,
      body: 'Changed',
    }),
    /current record revision/,
  );
  const original = await getMemory(f.shared, 'retry-rule');
  const input = {
    operation: 'update',
    id: original.id,
    at: later,
    body: 'A reviewed change.',
    recordRevision: original.revision,
  };
  const build = () => planMemoryMutation(f.shared, input);
  const preview = await build();
  const location = await memoryLocation(f.root, { shared: true });
  const filename = path.join(location.records, `${original.id}.md`);
  await fs.appendFile(filename, 'External edit.\n');
  await assert.rejects(
    applyManagedPlan(preview, build, preview.revision),
    /current record revision/,
  );
  assert.match((await getMemory(f.shared, original.id)).body, /External edit/);
});

test('a competing create invalidates an index preview; other records survive retry', async (t) => {
  const f = await fixture(t);
  const first = put(f.shared, 'first');
  const stale = await first();
  await apply(put(f.shared, 'second'));
  await assert.rejects(applyManagedPlan(stale, first, stale.revision), /Inputs changed/);
  await apply(first);
  const result = await queryMemory([await memoryLocation(f.root, { shared: true })]);
  assert.deepEqual(
    result.results.map((record) => record.id),
    ['first', 'second'],
  );
});

test('restore recovers an updated fact and its matching index; deletion keeps a recoverable original', async (t) => {
  const f = await fixture(t);
  await apply(put(f.shared));
  const original = await getMemory(f.shared, 'retry-rule');
  const updated = await apply(() =>
    planMemoryMutation(f.shared, {
      operation: 'update',
      id: original.id,
      at: later,
      title: 'Updated title',
      body: 'New body.',
      tags: ['api'],
      source: 'reviewed note',
      recordRevision: original.revision,
    }),
  );
  const restore = () => planManagedRestore(updated.backup, f.root);
  await apply(restore);
  assert.deepEqual(await getMemory(f.shared, original.id), original);
  const deleted = await apply(() =>
    planMemoryMutation(f.shared, {
      operation: 'delete',
      id: original.id,
      at: later,
      recordRevision: original.revision,
    }),
  );
  await assert.rejects(getMemory(f.shared, original.id), /not found/);
  await apply(() => planManagedRestore(deleted.backup, f.root));
  assert.deepEqual(await getMemory(f.shared, original.id), original);
});

test('unknown ownership, edited index blocks and malformed scoped metadata fail closed', async (t) => {
  const f = await fixture(t);
  await apply(put(f.shared));
  const location = await memoryLocation(f.root, { shared: true });
  const index = await fs.readFile(location.index, 'utf8');
  await fs.writeFile(location.index, index.replace('Retry requests safely', 'Changed locally'));
  await assert.rejects(put(f.shared, 'second')(), /managed block was edited/);
  await fs.writeFile(location.index, index);
  await fs.writeFile(path.join(location.records, 'broken.md'), '# No metadata\n');
  await assert.rejects(queryMemory([location]), /frontmatter/);
  await assert.rejects(put(f.shared, 'second')(), /frontmatter/);
});

test('record format rejects unsafe IDs, aliases, mismatched identity, unknown metadata and invalid timestamps', () => {
  const base = {
    version: 1,
    id: 'safe',
    scope: 'shared',
    title: 'Safe title',
    kind: 'fact',
    tags: [],
    created: at,
    updated: at,
    body: 'A fact.',
  };
  assert.equal(decodeMemory(encodeMemory(base), 'safe', 'shared').body, 'A fact.');
  assert.throws(() => encodeMemory({ ...base, id: '../escape' }), /IDs/);
  assert.throws(() => encodeMemory({ ...base, updated: 'yesterday' }), /timestamps/);
  assert.throws(() => encodeMemory({ ...base, secret: 'unknown' }), /unknown fields/);
  assert.throws(() => decodeMemory(encodeMemory(base), 'different', 'shared'), /identity/);
  assert.throws(() => encodeMemory({ ...base, tags: ['x', 'x'] }), /unique/);
  assert.throws(
    () =>
      decodeMemory(
        encodeMemory(base).replace('version: 1', 'version: 1\nbody: hidden'),
        'safe',
        'shared',
      ),
    /below the frontmatter/,
  );
  assert.throws(
    () => decodeMemory('---\nversion: 1\nid: &id safe\ntitle: *id\n---\nbody', 'safe', 'shared'),
    /Invalid memory/,
  );
});

test('memory never follows managed directory or record symlinks', async (t) => {
  const f = await fixture(t);
  const outside = path.join(f.directory, 'outside');
  await fs.mkdir(outside);
  await fs.symlink(outside, path.join(f.root, 'memory'), 'dir');
  await assert.rejects(put(f.shared)(), /real directory/);
  assert.deepEqual(await fs.readdir(outside), []);
  await fs.unlink(path.join(f.root, 'memory'));
  await apply(put(f.shared));
  const location = await memoryLocation(f.root, { shared: true });
  await fs.symlink(
    path.join(location.records, 'retry-rule.md'),
    path.join(location.records, 'alias.md'),
  );
  await assert.rejects(queryMemory([location]), /real file/);
});

test('session write previews are scoped, private, single-use and reject stale revisions', async (t) => {
  const f = await fixture(t);
  await project(f);
  const session = createMemorySession({
    root: f.root,
    workspace: f.workspaces[0],
    writable: true,
    includeShared: true,
  });
  await assert.rejects(
    session.preview({
      scope: 'shared',
      operation: 'create',
      id: 'private',
      title: 'A title',
      body: 'A body',
    }),
    /Writes are not enabled/,
  );
  await assert.rejects(
    session.preview({ project: 'other', operation: 'create', id: 'private' }),
    /Invalid memory mutation fields/,
  );
  const preview = await session.preview({
    operation: 'create',
    id: 'handoff',
    title: 'Handoff',
    body: 'Never publish automatically.',
  });
  assert.equal(JSON.stringify(preview).includes('Never publish'), false);
  await session.apply(preview.id, preview.revision);
  await assert.rejects(session.apply(preview.id, preview.revision), /expired, was used/);
  assert.equal((await session.get('handoff')).body, 'Never publish automatically.');
});

async function client(t, f, workspace, flags = []) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [cli, 'memory', 'serve', '--workspace', workspace, ...flags],
    env: { ...process.env, AGENT_HUB_HOME: f.root },
    stderr: 'pipe',
  });
  const connection = new Client({ name: 'memory-fixture', version: '1' });
  await connection.connect(transport);
  t.after(() => connection.close());
  return connection;
}

async function call(connection, name, args = {}) {
  const result = await connection.callTool({ name, arguments: args });
  return result.isError ? { error: result.content[0].text } : JSON.parse(result.content[0].text);
}

test('two independent MCP stdio clients share facts, reject stale writes and cannot access a foreign project', async (t) => {
  const f = await fixture(t);
  await project(f, 0, 'one');
  const other = await project(f, 1, 'two');
  await apply(put(other, 'private', { body: 'Foreign project secret.' }));
  const first = await client(t, f, f.workspaces[0], ['--allow-write']);
  const second = await client(t, f, f.workspaces[0], ['--allow-write']);
  const preview = await call(first, 'memory_preview', {
    operation: 'create',
    id: 'handoff',
    title: 'API retries',
    body: 'Always send an idempotency key.',
  });
  assert.equal(preview.changes, 3);
  assert.ok(
    (await call(first, 'memory_apply', { id: preview.id, revision: preview.revision })).backup,
  );
  const saved = await call(second, 'memory_get', { id: 'handoff' });
  assert.equal(saved.body, 'Always send an idempotency key.');
  const update = await call(second, 'memory_preview', {
    operation: 'update',
    id: 'handoff',
    body: 'Use a unique idempotency key.',
    recordRevision: saved.revision,
  });
  await call(second, 'memory_apply', { id: update.id, revision: update.revision });
  assert.match(
    (
      await call(first, 'memory_preview', {
        operation: 'delete',
        id: 'handoff',
        recordRevision: saved.revision,
      })
    ).error,
    /current record revision/,
  );
  assert.match((await call(first, 'memory_get', { id: 'private' })).error, /not found/);
  assert.match(
    (await call(first, 'memory_get', { id: 'private', scope: 'project:two' })).error,
    /Choose project or shared/,
  );
  assert.equal(
    JSON.stringify(await call(first, 'memory_search', { query: 'Foreign' })).includes(
      'Foreign project secret',
    ),
    false,
  );
});

test('read-only MCP does not expose or execute mutations; shared reads require explicit server configuration', async (t) => {
  const f = await fixture(t);
  await project(f);
  await apply(put(f.shared, 'shared-fact'));
  const readonly = await client(t, f, f.workspaces[0]);
  assert.deepEqual(
    (await readonly.listTools()).tools.map((tool) => tool.name),
    ['memory_list', 'memory_search', 'memory_get'],
  );
  assert.match(
    (await call(readonly, 'memory_preview', { operation: 'create', id: 'x' })).error,
    /disabled/,
  );
  assert.match(
    (await call(readonly, 'memory_get', { id: 'shared-fact', scope: 'shared' })).error,
    /not enabled/,
  );
  const shared = await client(t, f, f.workspaces[0], ['--include-shared']);
  assert.equal(
    (await call(shared, 'memory_get', { id: 'shared-fact', scope: 'shared' })).scope,
    'shared',
  );
});

test('CLI import preserves a local source and supports exact reviewed command replay', async (t) => {
  const f = await fixture(t);
  const source = path.join(f.directory, 'selected.md');
  await fs.writeFile(source, 'Selected durable knowledge.\n');
  const env = { ...process.env, AGENT_HUB_HOME: f.root };
  const args = [
    cli,
    'memory',
    'import',
    'selected',
    '--shared',
    '--title',
    'Selected knowledge',
    '--file',
    source,
    '--at',
    at,
    '--json',
  ];
  const preview = JSON.parse((await exec(process.execPath, args, { env })).stdout);
  assert.equal(preview.dryRun, true);
  await exec(process.execPath, [...args, '--apply', '--expect', preview.revision], { env });
  assert.equal((await getMemory(f.shared, 'selected')).source, source);
  assert.equal(await fs.readFile(source, 'utf8'), 'Selected durable knowledge.\n');
  const listed = JSON.parse(
    (
      await exec(process.execPath, [cli, 'memory', 'search', 'durable', '--shared', '--json'], {
        env,
      })
    ).stdout,
  );
  assert.equal(listed.results[0].id, 'selected');
});

test('memory UI API binds the project, requires a token and consumes reviewed previews once', async (t) => {
  const f = await fixture(t);
  await project(f);
  const ui = await startUiServer({
    port: 0,
    cwd: f.workspaces[0],
    services: {
      state: async () => ({}),
      memory: createMemorySession({
        root: f.root,
        workspace: f.workspaces[0],
        includeShared: true,
        writable: true,
        sharedWritable: true,
      }),
    },
  });
  t.after(() => ui.close());
  const token = (await (await fetch(`${ui.url}/api/state`)).json()).token;
  const automation = await (await fetch(`${ui.url}/api/memory/automation`)).json();
  assert.equal(automation.scope, 'project:demo');
  assert.equal(automation.policy.enabled, false);
  const post = (route, body, key = token) =>
    fetch(`${ui.url}${route}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Agent-Hub-Token': key },
      body: JSON.stringify(body),
    });
  assert.equal((await fetch(`${ui.url}/memory.js`)).status, 200);
  const input = {
    operation: 'create',
    id: 'ui-fact',
    title: '<script>Literal title</script>',
    body: 'A selected note. '.repeat(1200),
  };
  assert.equal((await post('/api/memory/preview', input, 'wrong')).status, 403);
  assert.equal(
    (await post('/api/memory/preview', { ...input, workspace: f.workspaces[1] })).status,
    409,
  );
  const response = await post('/api/memory/preview', input);
  assert.equal(response.status, 200);
  const preview = await response.json();
  assert.equal(JSON.stringify(preview).includes('A selected note'), false);
  assert.equal(
    (await post('/api/memory/apply', { id: preview.id, revision: preview.revision })).status,
    200,
  );
  assert.equal(
    (await post('/api/memory/apply', { id: preview.id, revision: preview.revision })).status,
    409,
  );
  const record = await (await fetch(`${ui.url}/api/memory?id=ui-fact`)).json();
  assert.equal(record.body, input.body);
  assert.equal((await fetch(`${ui.url}/api/memory?scope=project:other`)).status, 409);
});

test('reset archives created memory and restores the pre-memory checkpoint', async (t) => {
  const f = await fixture(t);
  await apply(put(f.shared));
  const plan = await planReset({}, f.root);
  assert.equal(plan.blocked, false);
  const result = await applyReset(plan, plan.revision);
  assert.ok(result.archive);
  assert.equal((await queryMemory([await memoryLocation(f.root, { shared: true })])).total, 0);
  const archived = await fs.readFile(
    path.join(result.archive, 'hub', 'memory', 'shared', 'records', 'retry-rule.md'),
    'utf8',
  );
  assert.match(archived, /idempotency key/);
});

test('competing MCP writers reject a stale collection plan and preserve both records after a fresh preview', async (t) => {
  const f = await fixture(t);
  await project(f);
  const first = await client(t, f, f.workspaces[0], ['--allow-write']);
  const second = await client(t, f, f.workspaces[0], ['--allow-write']);
  const inputs = ['first', 'second'].map((id) => ({
    operation: 'create',
    id,
    title: id,
    body: `${id} knowledge.`,
  }));
  const previews = await Promise.all([
    call(first, 'memory_preview', inputs[0]),
    call(second, 'memory_preview', inputs[1]),
  ]);
  const results = await Promise.all([
    call(first, 'memory_apply', { id: previews[0].id, revision: previews[0].revision }),
    call(second, 'memory_apply', { id: previews[1].id, revision: previews[1].revision }),
  ]);
  assert.equal(results.filter((result) => result.error).length, 1);
  const failed = results.findIndex((result) => result.error);
  const connection = failed === 0 ? first : second;
  const fresh = await call(connection, 'memory_preview', inputs[failed]);
  assert.ok(
    (await call(connection, 'memory_apply', { id: fresh.id, revision: fresh.revision })).backup,
  );
  const listed = await call(first, 'memory_list');
  assert.deepEqual(
    listed.results.map((record) => record.id),
    ['first', 'second'],
  );
});
