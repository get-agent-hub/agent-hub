import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { discoverProjects } from '../dist/core/projects/discovery.js';
import { createDiscoveryJobs } from '../dist/ui/project-discovery.js';
import { startUiServer } from '../dist/ui/server.js';
import { projectDiscoveryView } from '../ui/app/features/projects.js';
import {
  clientUi,
  completed,
  fixture,
  minimalReport,
  snapshot,
  tick,
} from './helpers/project-discovery.mjs';

test('local HTTP flow requires selection/token, rejects supplied paths and never authorizes discovered IDs', async (t) => {
  const f = await fixture(t);
  await f.session('chat', [f.root]);
  const previous = process.env.AGENT_HUB_HOME;
  const previousClaude = process.env.CLAUDE_CONFIG_DIR;
  process.env.AGENT_HUB_HOME = path.join(f.root, 'uninitialized-hub');
  process.env.CLAUDE_CONFIG_DIR = f.home;
  t.after(() => {
    if (previous === undefined) delete process.env.AGENT_HUB_HOME;
    else process.env.AGENT_HUB_HOME = previous;
    if (previousClaude === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = previousClaude;
  });
  let reads = 0;
  const ui = await startUiServer({
    port: 0,
    cwd: f.root,
    services: {
      state: async () => ({}),
      discoverProjects: async (clients) => {
        reads++;
        return discoverProjects(clients);
      },
    },
  });
  t.after(() => ui.close());
  const state = await (await fetch(`${ui.url}/api/state`)).json();
  assert.equal(reads, 0);
  assert.equal(
    state.discoveryClients.find((client) => client.id === 'claude-code').supported,
    true,
  );
  const post = (route, body, token = state.token, extra = {}) =>
    fetch(`${ui.url}${route}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Agent-Hub-Token': token, ...extra },
      body: JSON.stringify(body),
    });
  assert.equal(
    (await post('/api/projects/discover', { clients: ['claude-code'] }, '')).status,
    403,
  );
  assert.equal(
    (
      await post('/api/projects/discover', { clients: ['claude-code'] }, state.token, {
        Origin: 'https://example.invalid',
      })
    ).status,
    403,
  );
  for (const body of [
    { clients: [] },
    { clients: ['unknown'] },
    { clients: ['claude-code', 'claude-code'] },
    { clients: ['claude-code'], path: f.home },
    { clients: 'claude-code' },
  ])
    assert.equal((await post('/api/projects/discover', body)).status, 400);
  assert.equal(reads, 0);
  const before = await snapshot(f.root);
  const response = await post('/api/projects/discover', { clients: ['claude-code'] });
  assert.equal(response.status, 200);
  const report = await response.json();
  assert.equal(report.projects[0].chats, 1);
  assert.equal(reads, 1);
  assert.equal(
    (await post('/api/project/select', { projectId: report.projects[0].id })).status,
    409,
  );
  assert.equal((await fetch(`${ui.url}/features/projects.js`)).status, 200);
  assert.deepEqual(await snapshot(f.root), before);
});

test('HTTP discovery rejects overlapping scans and permits retry after a failed reader', async (t) => {
  const f = await fixture(t);
  const previous = process.env.AGENT_HUB_HOME;
  process.env.AGENT_HUB_HOME = path.join(f.root, 'hub');
  t.after(() => {
    if (previous === undefined) delete process.env.AGENT_HUB_HOME;
    else process.env.AGENT_HUB_HOME = previous;
  });
  let enter;
  const entered = new Promise((resolve) => {
    enter = resolve;
  });
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  let calls = 0;
  const ui = await startUiServer({
    port: 0,
    cwd: f.root,
    services: {
      state: async () => ({}),
      discoverProjects: async () => {
        if (++calls === 1) {
          enter();
          await gate;
          throw new Error('private-reader-error');
        }
        return discoverProjects(['claude-code'], [f.adapter]);
      },
    },
  });
  t.after(async () => {
    release();
    await ui.close();
  });
  const { token } = await (await fetch(`${ui.url}/api/state`)).json();
  const post = () =>
    fetch(`${ui.url}/api/projects/discover`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Agent-Hub-Token': token },
      body: JSON.stringify({ clients: ['claude-code'] }),
    });
  const running = post();
  await entered;
  assert.equal((await post()).status, 409);
  release();
  const failed = await running;
  assert.equal(failed.status, 500);
  assert.ok(!(await failed.text()).includes('private-reader-error'));
  assert.equal((await post()).status, 200);
});

test('UI output escapes source metadata and explains unsupported/partial discovery without claiming an archive', () => {
  const output = projectDiscoveryView({
    clients: [
      { id: 'claude-code', label: 'Claude', supported: true },
      { id: 'codex', label: 'Codex', supported: false },
    ],
    selected: ['claude-code'],
    report: {
      coverage: 'partial',
      issues: [],
      sources: [
        { label: 'Claude', coverage: 'partial', filesRead: 1, issues: ['<script>bad()</script>'] },
      ],
      projects: [
        {
          label: '<img onerror="bad()">',
          kind: 'missing',
          locations: ['/tmp/<script>'],
          chats: 1,
          clients: ['claude-code'],
        },
      ],
    },
  });
  assert.ok(!output.includes('<script>'));
  assert.ok(!output.includes('<img onerror='));
  assert.match(output, /not supported yet/);
  assert.match(output, /not a chat backup/);
  assert.match(output, /Folder unavailable/);
});

test('malformed unselected client settings cannot block discovery bootstrap or selected-source scans', async (t) => {
  const f = await fixture(t);
  await f.session('chat', [f.root]);
  const codex = path.join(f.root, 'codex');
  await fs.mkdir(codex);
  await fs.writeFile(path.join(codex, 'config.toml'), '[invalid TOML');
  const { state, post } = await clientUi(t, f);
  assert.equal(state.stateUnavailable, true);
  assert.ok(state.token);
  assert.ok(
    state.discoveryClients.some((client) => client.id === 'claude-code' && client.supported),
  );
  const start = await post('/api/projects/discovery/start', { clients: ['claude-code'] });
  assert.equal(start.status, 202);
  const report = await completed(post, (await start.json()).id);
  assert.equal(report.state, 'complete');
  assert.equal(report.projects[0].chats, 1);
  assert.equal(report.coverage, 'complete');
});

test('result pages bound rows and bytes while search and continuation cover all known groups', async (t) => {
  const f = await fixture(t);
  const scan = {
    source: 'fixture',
    coverage: 'complete',
    finished: true,
    filesRead: 1,
    bytesRead: 1,
    issues: [],
    sessions: [
      {
        id: 'many',
        locations: Array.from({ length: 500 }, (_, index) => path.join(f.root, `folder-${index}`)),
      },
    ],
  };
  const jobs = createDiscoveryJobs((clients, control) =>
    discoverProjects(clients, [{ ...f.adapter, discoverSessions: async () => scan }], control),
  );
  t.after(() => jobs.close());
  const id = jobs.start(['claude-code']);
  await jobs.wait(id);
  const all = new Set();
  let offset = 0;
  do {
    const page = jobs.status(id, offset);
    assert.ok(page.projects.length <= 100);
    assert.ok(Buffer.byteLength(JSON.stringify(page)) < 140 * 1024);
    for (const project of page.projects) all.add(project.id);
    if (page.nextOffset === null) break;
    offset = page.nextOffset;
  } while (offset > 0);
  assert.equal(all.size, 500);
  const filtered = jobs.status(id, 0, 'folder-499');
  assert.equal(filtered.matches, 1);
  assert.equal(filtered.projects[0].label, 'folder-499');
});

test('stopping a job settles immediately, ignores late results and permits a new scan', async (t) => {
  let enter;
  const entered = new Promise((resolve) => {
    enter = resolve;
  });
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  let calls = 0;
  const jobs = createDiscoveryJobs(async () => {
    if (++calls === 1) {
      enter();
      await gate;
    }
    return minimalReport();
  });
  t.after(() => {
    release();
    jobs.close();
  });
  const first = jobs.start(['claude-code']);
  assert.equal(jobs.start(['claude-code']), first);
  await entered;
  jobs.stop(first);
  assert.equal((await jobs.wait(first)).state, 'cancelled');
  const second = jobs.start(['claude-code']);
  assert.notEqual(first, second);
  assert.equal((await jobs.wait(second)).state, 'complete');
  release();
  await tick();
  assert.equal(jobs.status(first).state, 'cancelled');
});

test('previous observations survive failed/partial scans but a complete empty scan confirms absence', async (t) => {
  const project = {
    id: 'discovered:' + 'a'.repeat(24),
    label: 'original',
    kind: 'folder',
    locations: ['/fixture/original'],
    chats: 1,
    clients: ['claude-code'],
  };
  let mode = 'success';
  const jobs = createDiscoveryJobs(async () => {
    if (mode === 'fail') throw new Error('private-error');
    return minimalReport(
      mode === 'success' ? [project] : [],
      mode === 'partial' ? 'partial' : 'complete',
    );
  });
  t.after(() => jobs.close());
  const first = jobs.start(['claude-code']);
  await jobs.wait(first);
  mode = 'fail';
  const failed = jobs.start(['claude-code']);
  await jobs.wait(failed);
  assert.equal(jobs.status(failed).projects[0].previous, true);
  assert.ok(!JSON.stringify(jobs.status(failed)).includes('private-error'));
  mode = 'partial';
  const partial = jobs.start(['claude-code']);
  await jobs.wait(partial);
  assert.equal(jobs.status(partial).projects[0].previous, true);
  mode = 'empty';
  const empty = jobs.start(['claude-code']);
  await jobs.wait(empty);
  assert.equal(jobs.status(empty).total, 0);
});

test('revealing folders requires a retained source reference and rechecks current filesystem bindings', async (t) => {
  const f = await fixture(t);
  const directory = path.join(f.root, 'plain');
  await fs.mkdir(directory);
  await f.session('chat', [directory]);
  const revealed = [];
  const { post } = await clientUi(t, f, {
    state: async () => ({}),
    revealDirectory: async (folder) => {
      revealed.push(folder);
    },
  });
  const started = await (
    await post('/api/projects/discovery/start', { clients: ['claude-code'] })
  ).json();
  const report = await completed(post, started.id);
  const payload = { id: report.id, projectId: report.projects[0].id };
  assert.equal(
    (await post('/api/projects/discovery/reveal', { ...payload, path: directory })).status,
    400,
  );
  assert.equal((await post('/api/projects/discovery/reveal', payload, '')).status, 403);
  assert.equal(
    (
      await post('/api/projects/discovery/reveal', {
        ...payload,
        projectId: 'discovered:' + '0'.repeat(24),
      })
    ).status,
    409,
  );
  assert.equal((await post('/api/projects/discovery/reveal', payload)).status, 200);
  assert.deepEqual(revealed, [directory]);
  await fs.rename(directory, directory + '-moved');
  await fs.symlink(f.root, directory);
  assert.equal((await post('/api/projects/discovery/reveal', payload)).status, 409);
  assert.deepEqual(revealed, [directory]);
});

test('status/cancel requests require operator token and reject path, page and scan injection', async (t) => {
  const f = await fixture(t);
  const { post } = await clientUi(t, f, { state: async () => ({}) });
  assert.deepEqual(await (await post('/api/projects/discovery/status', {})).json(), { job: null });
  for (const route of ['status', 'cancel'])
    assert.equal((await post('/api/projects/discovery/' + route, {}, '')).status, 403);
  for (const payload of [
    { id: '../file' },
    { path: f.home },
    { offset: -1 },
    { offset: 1.2 },
    { offset: 9000 },
    { query: 'x'.repeat(257) },
  ])
    assert.equal((await post('/api/projects/discovery/status', payload)).status, 400);
});

test('aborting the legacy HTTP read releases public busy state without accepting late results', async (t) => {
  const f = await fixture(t);
  let enter;
  const entered = new Promise((resolve) => {
    enter = resolve;
  });
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  let calls = 0;
  const { post, ui, state } = await clientUi(t, f, {
    state: async () => ({}),
    discoverProjects: async () => {
      if (++calls === 1) {
        enter();
        await gate;
      }
      return minimalReport();
    },
  });
  t.after(() => release());
  const controller = new AbortController();
  const pending = fetch(ui.url + '/api/projects/discover', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Agent-Hub-Token': state.token },
    body: JSON.stringify({ clients: ['claude-code'] }),
    signal: controller.signal,
  }).catch(() => null);
  await entered;
  controller.abort();
  await pending;
  let cancelled;
  for (let attempt = 0; attempt < 100; attempt++) {
    cancelled = await (await post('/api/projects/discovery/status', {})).json();
    if (cancelled.state === 'cancelled') break;
    await tick();
  }
  assert.equal(cancelled.state, 'cancelled');
  assert.equal((await post('/api/projects/discover', { clients: ['claude-code'] })).status, 200);
  release();
  await tick();
});

test('UI separates working folders, labels stale observations and keeps details open', () => {
  const report = {
    ...minimalReport(
      [
        {
          id: 'discovered:' + 'b'.repeat(24),
          label: 'same-name',
          kind: 'folder',
          locations: ['/fixture/one/same-name'],
          chats: 1,
          clients: ['claude-code'],
          previous: true,
        },
      ],
      'partial',
    ),
    state: 'failed',
    total: 1,
    error: 'Reader unavailable',
  };
  const html = projectDiscoveryView({
    clients: [{ id: 'claude-code', label: 'Claude', supported: true }],
    selected: ['claude-code'],
    report,
    opened: ['coverage'],
    error: 'Request failed',
  });
  assert.match(html, /Other working folders/);
  assert.match(html, /Previous result/);
  assert.match(html, /\/fixture\/one\/same-name/);
  assert.match(html, /data-discovery-detail="coverage" open/);
  assert.ok(!html.includes('class="banner ok"'));
  assert.match(html, /Reveal folder/);
});
