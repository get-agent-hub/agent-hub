import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { planMemoryProject, memoryLocation } from '../dist/core/memory-projects.js';
import { planAutomationSetup } from '../dist/core/memory-auto-setup.js';
import { applyManagedPlan } from '../dist/core/managed-plan.js';
import { syncNativeAutomatically } from '../dist/core/memory-auto-sync.js';
import { queryMemory } from '../dist/core/memory-store.js';
import { getMemory, planMemoryMutation } from '../dist/core/memory.js';
import { planAutomationDisable } from '../dist/core/memory-auto-setup.js';
import { autoStatus } from '../dist/core/memory-auto-status.js';
import {
  getAutomaticConflict,
  planAutomaticResolution,
} from '../dist/core/memory-auto-conflicts.js';
import { createMemorySession } from '../dist/core/memory-session.js';
import { automaticCheckpoint, memoryHook } from '../dist/core/memory-auto-runtime.js';
import { startUiServer } from '../dist/ui/server.js';
import { apply as dshMemory } from '../dist/integrations/dsh-memory.js';

const exec = promisify(execFile);
async function apply(build) {
  const plan = await build();
  return applyManagedPlan(plan, build, plan.revision);
}
async function fixture(t) {
  const directory = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), 'ahub-consistency-')),
  );
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const root = path.join(directory, 'hub');
  const workspace = path.join(directory, 'project');
  await fs.mkdir(root);
  await fs.mkdir(workspace);
  await fs.writeFile(path.join(root, 'hub.yaml'), 'version: 1\n');
  await exec('git', ['init', '-q', workspace]);
  await apply(() => planMemoryProject(root, 'demo', workspace));
  const native = {};
  for (const client of ['claude-code', 'dsh']) {
    native[client] = path.join(directory, client);
    await fs.mkdir(native[client]);
  }
  return {
    root,
    workspace,
    directory,
    native,
    async enable(client) {
      return apply(() =>
        planAutomationSetup(root, workspace, client, {
          hookFile: path.join(directory, `${client}.json`),
          dshPatch: path.join(directory, 'cordis.patch.yml'),
          nativeDir: native[client],
        }),
      );
    },
    async records() {
      return (await queryMemory([await memoryLocation(root, { workspace })], '', 100)).results;
    },
    context: { root, selector: { workspace } },
  };
}

test('native code examples with different indentation are separate knowledge', async (t) => {
  const f = await fixture(t);
  await fs.writeFile(
    path.join(f.native['claude-code'], 'a.md'),
    '# A\n```python\nif ready:\n    save()\n```\n',
  );
  await fs.writeFile(
    path.join(f.native['claude-code'], 'b.md'),
    '# B\n```python\nif ready:\nsave()\n```\n',
  );
  await f.enable('claude-code');
  await syncNativeAutomatically(f.root, f.workspace);
  assert.equal((await f.records()).length, 2);
});

async function mutate(f, input) {
  const value = { ...input, at: new Date().toISOString() };
  return apply(() => planMemoryMutation(f.context, value));
}
async function resolve(f, id, take) {
  const at = new Date().toISOString();
  return apply(() => planAutomaticResolution(f.root, f.workspace, id, take, at));
}

async function nativeConflict(t) {
  const f = await fixture(t);
  const source = path.join(f.native['claude-code'], 'api.md');
  await fs.writeFile(source, '# API\nOriginal contract.\n');
  await f.enable('claude-code');
  await syncNativeAutomatically(f.root, f.workspace);
  const original = await getMemory(f.context, (await f.records())[0].id);
  await mutate(f, {
    operation: 'update',
    id: original.id,
    body: 'Reviewed Hub correction.',
    recordRevision: original.revision,
  });
  await fs.writeFile(source, '# API\nChanged external contract.\n');
  await syncNativeAutomatically(f.root, f.workspace);
  return { ...f, source, id: original.id };
}

test('keeping Hub acknowledges an exact source version and preserves conflict history after resolution', async (t) => {
  const f = await nativeConflict(t);
  const conflict = await getAutomaticConflict(f.root, f.workspace, f.id);
  assert.equal(conflict.current.body, 'Reviewed Hub correction.');
  assert.equal(conflict.incoming.body, 'Changed external contract.');
  assert.equal(conflict.versions.length, 1);
  await resolve(f, f.id, 'hub');
  assert.equal((await syncNativeAutomatically(f.root, f.workspace)).changedPaths, 0);
  assert.equal((await autoStatus(f.root, f.workspace)).conflicts.length, 0);
  const archived = await getAutomaticConflict(f.root, f.workspace, f.id, conflict.versions[0]);
  assert.equal(archived.incoming.body, conflict.incoming.body);
  await fs.writeFile(f.source, '# API\nAnother external change.\n');
  assert.equal((await syncNativeAutomatically(f.root, f.workspace)).conflicts, 1);
  assert.equal((await getAutomaticConflict(f.root, f.workspace, f.id)).versions.length, 2);
  assert.equal((await getMemory(f.context, f.id)).body, 'Reviewed Hub correction.');
});

test('a reviewed conflict preview rejects both a changed queue and changed Hub value', async (t) => {
  const f = await nativeConflict(t);
  const session = createMemorySession({ root: f.root, workspace: f.workspace, writable: true });
  const first = await session.previewConflict(f.id, 'incoming');
  await fs.writeFile(f.source, '# API\nLater source version.\n');
  await syncNativeAutomatically(f.root, f.workspace);
  await assert.rejects(session.apply(first.id, first.revision), /Inputs changed/);
  const second = await session.previewConflict(f.id, 'incoming');
  const current = await getMemory(f.context, f.id);
  await mutate(f, {
    operation: 'update',
    id: f.id,
    body: 'Another user correction.',
    recordRevision: current.revision,
  });
  await assert.rejects(
    session.apply(second.id, second.revision),
    /Inputs changed|timestamp precedes/,
  );
  const third = await session.previewConflict(f.id, 'incoming');
  await session.apply(third.id, third.revision);
  await assert.rejects(session.apply(third.id, third.revision), /was used/);
  assert.equal((await getMemory(f.context, f.id)).body, 'Later source version.');
  assert.match(await fs.readFile(f.source, 'utf8'), /Later source version/);
  const reader = createMemorySession({ root: f.root, workspace: f.workspace });
  await assert.rejects(reader.previewConflict(f.id, 'hub'), /Writes are not enabled/);
});

test('keeping an explicit Hub deletion prevents source resurrection', async (t) => {
  const f = await nativeConflict(t);
  const current = await getMemory(f.context, f.id);
  await mutate(f, { operation: 'delete', id: f.id, recordRevision: current.revision });
  await resolve(f, f.id, 'hub');
  assert.equal((await syncNativeAutomatically(f.root, f.workspace)).changedPaths, 0);
  assert.equal((await f.records()).length, 0);
});

test('HTTP conflict review requires a token and applies only the exact reviewed project resolution', async (t) => {
  const f = await nativeConflict(t);
  const ui = await startUiServer({
    port: 0,
    cwd: f.workspace,
    services: {
      state: async () => ({}),
      memory: createMemorySession({ root: f.root, workspace: f.workspace, writable: true }),
    },
  });
  t.after(() => ui.close());
  const token = (await (await fetch(`${ui.url}/api/state`)).json()).token;
  const post = (route, value, key = token) =>
    fetch(`${ui.url}${route}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Agent-Hub-Token': key },
      body: JSON.stringify(value),
    });
  const conflict = await (await fetch(`${ui.url}/api/memory/conflict?id=${f.id}`)).json();
  assert.equal(conflict.current.body, 'Reviewed Hub correction.');
  assert.equal(conflict.incoming.body, 'Changed external contract.');
  assert.equal('snapshot' in conflict, false);
  assert.equal(
    (await post('/api/memory/conflict/preview', { id: f.id, take: 'hub' }, 'invalid')).status,
    403,
  );
  assert.equal(
    (await post('/api/memory/conflict/preview', { id: f.id, take: 'hub', workspace: f.directory }))
      .status,
    400,
  );
  const response = await post('/api/memory/conflict/preview', { id: f.id, take: 'hub' });
  assert.equal(response.status, 200);
  const preview = await response.json();
  assert.equal((await getMemory(f.context, f.id)).body, 'Reviewed Hub correction.');
  const receipt = { id: preview.id, revision: preview.revision };
  assert.equal((await post('/api/memory/apply', receipt)).status, 200);
  assert.equal((await post('/api/memory/apply', receipt)).status, 409);
  assert.equal((await autoStatus(f.root, f.workspace)).conflicts.length, 0);
});

test('semantic checkpoint conflicts can be inspected and resolved even after automation is disabled', async (t) => {
  const f = await fixture(t);
  await f.enable('dsh');
  const payload = { cwd: f.workspace, session_id: 'semantic', hook_event_name: 'Stop' };
  const checkpoint = async (body) => {
    const stop = await memoryHook(f.root, 'dsh', payload);
    const token = /checkpoint:([a-f0-9]{32})/.exec(stop.reason)[1];
    return automaticCheckpoint(f.root, f.workspace, 'dsh', token, {
      session: 'semantic',
      facts: [
        { key: 'api-rule', title: 'API', body, kind: 'fact', evidence: 'Verified API contract.' },
      ],
    });
  };
  await checkpoint('Original contract.');
  const original = await getMemory(f.context, (await f.records())[0].id);
  await mutate(f, {
    operation: 'update',
    id: original.id,
    body: 'Hub correction.',
    recordRevision: original.revision,
  });
  await memoryHook(f.root, 'dsh', {
    ...payload,
    hook_event_name: 'UserPromptSubmit',
    prompt: 'Next task.',
  });
  assert.equal((await checkpoint('Incoming semantic correction.')).conflicts, 1);
  await apply(() => planAutomationDisable(f.root, f.workspace));
  const conflict = await getAutomaticConflict(f.root, f.workspace, original.id);
  assert.equal(conflict.incoming.body, 'Incoming semantic correction.');
  await resolve(f, original.id, 'incoming');
  assert.equal((await getMemory(f.context, original.id)).body, 'Incoming semantic correction.');
  assert.equal((await autoStatus(f.root, f.workspace)).conflicts.length, 0);
});

test('status reports missing and malformed native sources without copying their contents', async (t) => {
  const f = await fixture(t);
  await f.enable('claude-code');
  const note = path.join(f.native['claude-code'], 'broken.md');
  await fs.writeFile(note, '---\nname: [\n---\nDO_NOT_RETAIN_PRIVATE_BODY');
  const status = await autoStatus(f.root, f.workspace);
  assert.equal(status.native[0].skipped.length, 1);
  assert.equal(JSON.stringify(status).includes('DO_NOT_RETAIN_PRIVATE_BODY'), false);
  await fs.rm(f.native['claude-code'], { recursive: true });
  const missing = await autoStatus(f.root, f.workspace);
  assert.match(missing.native[0].skipped[0].reason, /missing/);
  assert.equal((await syncNativeAutomatically(f.root, f.workspace)).skipped, 1);
});

test('DSH accepts a user fork, skips delegated agents and refuses cross-project cwd drift', async (t) => {
  const f = await fixture(t);
  await f.enable('dsh');
  const other = path.join(f.directory, 'other-project');
  await fs.mkdir(other);
  await exec('git', ['init', '-q', other]);
  await apply(() => planMemoryProject(f.root, 'other', other));
  await apply(() =>
    planAutomationSetup(f.root, other, 'dsh', {
      hookFile: path.join(f.directory, 'dsh.json'),
      dshPatch: path.join(f.directory, 'cordis.patch.yml'),
    }),
  );
  let cwd = f.workspace;
  const events = new Map();
  const warnings = [];
  dshMemory(
    {
      on: (name, callback) => events.set(name, callback),
      get: () => ({ get: () => cwd }),
      effect: (start) => t.after(start()),
      logger: { warn: (message) => warnings.push(message) },
    },
    { root: f.root },
  );
  const injected = [];
  const steered = [];
  const agent = {
    id: 'user-fork',
    session: { header: { cwd, parentSession: 'original-user-session' } },
    inject: (message) => injected.push(message),
    steer: (message) => steered.push(message),
  };
  await events.get('agent/created')({ agent });
  assert.equal(injected.length, 1);
  const child = {
    ...agent,
    id: 'delegated-child',
    session: { header: { cwd, origin: 'subagent', delegationDepth: 1 } },
  };
  await events.get('agent/created')({ agent: child });
  await events.get('agent/turn-stopping')({ agent: child });
  assert.equal(injected.length, 1);
  assert.equal(steered.length, 0);
  cwd = other;
  await events.get('agent/turn-stopping')({ agent });
  assert.equal(steered.length, 0);
  assert.match(warnings.join('\n'), /another memory project/);
  assert.equal((await createMemorySession({ root: f.root, workspace: other }).list()).total, 0);
});

test('Markdown example headings inside code fences never split a native note', async (t) => {
  const f = await fixture(t);
  const body =
    'Example:\n```markdown\n## This is code, not a memory section\nKeep the example intact.\n```';
  await fs.writeFile(path.join(f.native['claude-code'], 'example.md'), `# Example note\n${body}\n`);
  await f.enable('claude-code');
  await syncNativeAutomatically(f.root, f.workspace);
  const records = await f.records();
  assert.equal(records.length, 1);
  assert.equal((await getMemory(f.context, records[0].id)).body, body);
});

test('divergent Claude and DSH sources keep one canonical fact and a visible conflict without second-run drift', async (t) => {
  const f = await fixture(t);
  const first = path.join(f.native['claude-code'], 'api.md');
  const second = path.join(f.native.dsh, 'api.md');
  await fs.writeFile(first, '# API\nOriginal contract.\n');
  await fs.writeFile(second, '# API\nOriginal contract.\n');
  await f.enable('claude-code');
  await f.enable('dsh');
  await syncNativeAutomatically(f.root, f.workspace);
  assert.equal((await f.records()).length, 1);
  await fs.writeFile(first, '# API\nUpdated contract from Claude.\n');
  const changed = await syncNativeAutomatically(f.root, f.workspace);
  const again = await syncNativeAutomatically(f.root, f.workspace);
  assert.equal(changed.conflicts, 1);
  assert.equal(again.changedPaths, 0);
  assert.equal(again.conflicts, 1);
  assert.equal((await f.records()).length, 1);
  assert.equal(
    (await getMemory(f.context, (await f.records())[0].id)).body,
    'Updated contract from Claude.',
  );
  assert.match(await fs.readFile(second, 'utf8'), /Original contract/);
});
