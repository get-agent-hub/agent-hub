import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { confirmReviewed } from '../dist/commands/review.js';
import { readiness } from '../dist/core/readiness.js';
import {
  memoryOverview,
  projectCatalog,
  registeredWorkspace,
} from '../dist/core/project-catalog.js';
import { planMemoryProject } from '../dist/core/memory-projects.js';
import { applyManagedPlan } from '../dist/core/managed-plan.js';
import { startUiServer } from '../dist/ui/server.js';

test('interactive confirmation is explicit, terminal-only and accepts only a reviewed unblocked plan', async () => {
  let called = 0;
  const io = {
    available: () => true,
    confirm: async (_message, fallback) => {
      called++;
      assert.equal(fallback, false);
      return true;
    },
  };
  assert.equal(await confirmReviewed({}, false, io), false);
  assert.equal(await confirmReviewed({ interactive: true }, true, io), false);
  assert.equal(called, 0);
  assert.equal(await confirmReviewed({ interactive: true }, false, io), true);
  assert.equal(
    await confirmReviewed({ interactive: true }, false, { ...io, confirm: async () => false }),
    false,
  );
  for (const options of [
    { interactive: true, json: true },
    { interactive: true, dryRun: true },
  ])
    await assert.rejects(confirmReviewed(options, false, io), /terminal/);
  await assert.rejects(
    confirmReviewed({ interactive: true }, false, { ...io, available: () => false }),
    /terminal/,
  );
});

async function fixture(t) {
  const base = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'ahub-usability-')));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const root = path.join(base, 'hub');
  await fs.mkdir(path.join(root, 'mcp'), { recursive: true });
  await fs.writeFile(path.join(root, 'hub.yaml'), 'version: 1\n');
  await fs.writeFile(
    path.join(root, 'mcp/servers.yaml'),
    'version: 1\nservers:\n  demo:\n    command: fixture-server\n',
  );
  const projects = [];
  for (const id of ['first', 'second']) {
    const directory = path.join(base, id);
    execFileSync('git', ['init', '-q', directory]);
    const build = () => planMemoryProject(root, id, directory);
    const plan = await build();
    await applyManagedPlan(plan, build, plan.revision);
    projects.push(directory);
  }
  return { root, base, projects };
}

test('readiness distinguishes untested, stale and verified connections, documents are not records', async (t) => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.root, 'memory/custom.md'), '# Not a canonical record\n');
  const status = { clients: [{ id: 'codex', installed: true }], drift: [] };
  const options = { root: f.root, workspace: f.base, status, doctor: null, inspectContext: false };
  const untested = await readiness(options);
  assert.equal(untested.configuration, 'matched');
  assert.equal(untested.connections, 'not-checked');
  assert.equal(untested.memory.state, 'not-connected');
  assert.equal(untested.memory.defaultScope, 'shared');
  assert.equal(untested.memory.sharedRecords, 0);
  const { planMemoryMutation } = await import('../dist/core/memory.js');
  for (const selector of [{ shared: true }, { workspace: f.projects[0] }]) {
    const build = () =>
      planMemoryMutation(
        { root: f.root, selector },
        {
          operation: 'create',
          id: 'durable-fact',
          title: 'API rule',
          body: 'Retry idempotently.',
          at: '2026-01-01T00:00:00.000Z',
        },
      );
    const plan = await build();
    await applyManagedPlan(plan, build, plan.revision);
  }
  assert.equal((await memoryOverview(f.root, f.projects[0])).sharedRecords, 1);
  assert.equal((await memoryOverview(f.root, f.projects[0])).projectRecords, 1);
  assert.equal((await memoryOverview(f.root, f.projects[1])).projectRecords, 0);
  const doctor = { stale: true, report: { results: [{ name: 'demo', status: 'ok' }] } };
  assert.equal((await readiness({ ...options, doctor })).connections, 'stale');
  doctor.stale = false;
  assert.equal((await readiness({ ...options, doctor })).connections, 'passed');
  assert.equal((await memoryOverview(f.root, f.projects[0])).projectId, 'first');
  assert.equal((await memoryOverview(f.root, f.projects[0])).defaultScope, 'project');
});

test('UI project selection validates registered identities and expires plans across switches', async (t) => {
  const f = await fixture(t);
  const previous = process.env.AGENT_HUB_HOME;
  process.env.AGENT_HUB_HOME = f.root;
  t.after(() => {
    if (previous === undefined) delete process.env.AGENT_HUB_HOME;
    else process.env.AGENT_HUB_HOME = previous;
  });
  const seen = [];
  const ui = await startUiServer({
    port: 0,
    cwd: f.projects[0],
    services: {
      state: async (cwd) => {
        seen.push(cwd);
        return { readiness: { memory: await memoryOverview(f.root, cwd) } };
      },
      projectPlan: async (options) => ({
        options,
        publicPlan: {
          revision: 'fixture',
          blocked: false,
          scope: 'project',
          workspace: options.workspace,
        },
      }),
    },
  });
  t.after(() => ui.close());
  const state = await (await fetch(`${ui.url}/api/state`)).json();
  const post = (route, body) =>
    fetch(`${ui.url}${route}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Agent-Hub-Token': state.token },
      body: JSON.stringify(body),
    });
  assert.equal(state.selection.projectId, 'first');
  const previewResponse = await post('/api/project/connect/preview', {});
  assert.equal(previewResponse.status, 200);
  const preview = await previewResponse.json();
  assert.equal((await post('/api/project/select', { projectId: f.base })).status, 409);
  assert.equal((await post('/api/project/select', { projectId: 'second' })).status, 200);
  assert.equal(
    (
      await post('/api/project/connect/apply', {
        previewId: preview.previewId,
        revision: preview.revision,
      })
    ).status,
    409,
  );
  const selected = await (await fetch(`${ui.url}/api/state`)).json();
  assert.equal(selected.selection.projectId, 'second');
  assert.equal(seen.at(-1), f.projects[1]);
  assert.equal((await post('/api/project/select', { projectId: null })).status, 200);
  const shared = await (await fetch(`${ui.url}/api/state`)).json();
  assert.equal(shared.selection.memoryScope, 'shared');
  assert.equal(shared.workspace, null);
  assert.equal(shared.readiness.memory.projectId, null);
  assert.equal((await post('/api/project/connect/preview', {})).status, 409);
  assert.equal((await fetch(`${ui.url}/api/memory?scope=project`)).status, 409);
  assert.equal((await post('/api/project/select', { projectId: '@current' })).status, 200);
  assert.equal((await projectCatalog(f.root)).length, 2);
  await fs.rm(path.join(f.projects[1], '.git'), { recursive: true });
  execFileSync('git', ['init', '-q', f.projects[1]]);
  await assert.rejects(registeredWorkspace(f.root, 'second'), /No verified checkout/);
});

test('disconnect gates all checkouts and pending sessions while preserving knowledge and reconnect identity', async (t) => {
  const f = await fixture(t);
  const { planProjectDisconnect } = await import('../dist/core/project-disconnect.js');
  const { memoryLocation } = await import('../dist/core/memory-projects.js');
  const directory = path.join(f.root, 'memory/projects/first');
  await fs.mkdir(path.join(directory, 'automation/sessions'), { recursive: true });
  await fs.writeFile(path.join(directory, 'retained.md'), 'User knowledge');
  await fs.writeFile(path.join(directory, 'automation/sessions/pending.json'), '{}');
  await fs.writeFile(
    path.join(directory, 'automation/policy.json'),
    JSON.stringify({ version: 1, enabled: true, clients: ['codex'], native: [] }),
  );
  const build = () => planProjectDisconnect(f.root, 'first');
  const plan = await build();
  assert.equal((await memoryLocation(f.root, { workspace: f.projects[0] })).scope, 'project:first');
  await applyManagedPlan(plan, build, plan.revision);
  await assert.rejects(memoryLocation(f.root, { workspace: f.projects[0] }), /disconnected/);
  assert.equal(await registeredWorkspace(f.root, 'first'), f.projects[0]);
  assert.equal(await fs.readFile(path.join(directory, 'retained.md'), 'utf8'), 'User knowledge');
  assert.equal(
    JSON.parse(await fs.readFile(path.join(directory, 'automation/policy.json'), 'utf8')).enabled,
    false,
  );
  await assert.rejects(fs.access(path.join(directory, 'automation/sessions')));
  const reconnect = () => planMemoryProject(f.root, 'first', f.projects[0]);
  const reconnectPlan = await reconnect();
  assert.equal(reconnectPlan.blocked, false);
  await applyManagedPlan(reconnectPlan, reconnect, reconnectPlan.revision);
  assert.equal((await memoryLocation(f.root, { workspace: f.projects[0] })).scope, 'project:first');
  assert.equal((await build()).blocked, false);
});

test('partially failed workflows can undo completed stages without replacing the first baseline', async (t) => {
  const f = await fixture(t);
  const { withWorkflowRecovery, planUndo, applyUndo } =
    await import('../dist/core/workflow-recovery.js');
  const { planReset, applyReset } = await import('../dist/core/reset.js');
  const { inspectTree } = await import('../dist/core/recovery-tree.js');
  const before = (await inspectTree(f.root)).fingerprint;
  await assert.rejects(
    withWorkflowRecovery(
      f.root,
      'project',
      async () => {},
      async () => {
        const { planProjectDisconnect } = await import('../dist/core/project-disconnect.js');
        const build = () => planProjectDisconnect(f.root, 'first');
        const plan = await build();
        await applyManagedPlan(plan, build, plan.revision);
        throw new Error('fixture later stage failed');
      },
    ),
    /later stage failed/,
  );
  const undo = await planUndo('latest', f.root);
  assert.equal(undo.run.state, 'partial');
  assert.equal(undo.blocked, false);
  await applyUndo(undo, undo.revision);
  assert.equal((await inspectTree(f.root)).fingerprint, before);
  const reset = await planReset({}, f.root);
  assert.equal(reset.blocked, false);
  await applyReset(reset, reset.revision);
});
