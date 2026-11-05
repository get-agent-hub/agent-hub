import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { claudeSessions } from '../dist/adapters/claude-sessions.js';
import { discoverProjects } from '../dist/core/project-discovery.js';
import { startUiServer } from '../dist/ui/server.js';
import { projectDiscoveryView } from '../ui/app/projects.js';
import { createDiscoveryJobs } from '../dist/ui/project-discovery.js';

async function fixture(t) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'agent-hub-discovery-')));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const home = path.join(root, 'claude');
  await fs.mkdir(path.join(home, 'projects'), { recursive: true });
  const session = async (name, locations, collection = 'not-a-decoded-project-name') => {
    const directory = path.join(home, 'projects', collection);
    await fs.mkdir(directory, { recursive: true });
    const file = path.join(directory, `${name}.jsonl`);
    await fs.writeFile(
      file,
      locations
        .map((cwd) =>
          JSON.stringify({
            type: 'user',
            sessionId: name,
            cwd,
            message: { content: 'private-transcript-body' },
          }),
        )
        .join('\n') + '\n',
    );
    return file;
  };
  const adapter = {
    id: 'claude-code',
    label: 'Claude Code',
    discoverSessions: (control) => claudeSessions(home, undefined, control),
  };
  return { root, home, session, adapter };
}

function git(cwd, ...args) {
  return execFileSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

async function snapshot(root) {
  const result = {};
  async function visit(directory) {
    for (const name of await fs.readdir(directory)) {
      const file = path.join(directory, name);
      const stat = await fs.lstat(file);
      const key = path.relative(root, file);
      result[key] = stat.isSymbolicLink()
        ? { link: await fs.readlink(file) }
        : stat.isDirectory()
          ? { directory: true }
          : {
              bytes: (await fs.readFile(file)).toString('base64'),
              mode: stat.mode,
              mtime: stat.mtimeMs,
            };
      if (stat.isDirectory()) await visit(file);
    }
  }
  await visit(root);
  return result;
}

test('discovers non-Git projects from metadata without registration, body exposure or source writes', async (t) => {
  const f = await fixture(t);
  const folder = path.join(f.root, 'plain project');
  await fs.mkdir(folder);
  await f.session('chat-one', [folder]);
  const before = await snapshot(f.root);
  const first = await discoverProjects(['claude-code'], [f.adapter]);
  assert.equal(first.coverage, 'complete');
  assert.equal(first.metadataOnly, true);
  assert.deepEqual(
    first.projects.map(({ label, chats, kind }) => ({ label, chats, kind })),
    [{ label: 'plain project', chats: 1, kind: 'folder' }],
  );
  assert.ok(!JSON.stringify(first).includes('private-transcript-body'));
  const repeated = await discoverProjects(['claude-code'], [f.adapter]);
  assert.deepEqual(repeated.projects, first.projects);
  assert.deepEqual(repeated.sources, first.sources);
  assert.ok(repeated.checkedAt);
  assert.deepEqual(await snapshot(f.root), before);
});

test('groups verified worktrees and nested cwd while keeping same-named clones and folders distinct', async (t) => {
  const f = await fixture(t);
  const repo = path.join(f.root, 'shop');
  const tree = path.join(f.root, 'shop-feature');
  await fs.mkdir(repo);
  git(repo, 'init', '-q', '-b', 'master');
  git(
    repo,
    '-c',
    'user.name=Fixture',
    '-c',
    'user.email=fixture@example.invalid',
    'commit',
    '--allow-empty',
    '-qm',
    'fixture',
  );
  git(repo, 'worktree', 'add', '-qb', 'feature', tree);
  await fs.mkdir(path.join(repo, 'src'));
  const clone = path.join(f.root, 'clone', 'shop');
  await fs.mkdir(clone, { recursive: true });
  git(clone, 'init', '-q', '-b', 'master');
  const folder = path.join(f.root, 'ordinary');
  await fs.mkdir(folder);
  await f.session('first', [path.join(repo, 'src'), tree, folder]);
  await f.session('second', [repo]);
  await f.session('third', [clone]);
  const before = await snapshot(f.root);
  const result = await discoverProjects(['claude-code'], [f.adapter]);
  assert.equal(result.projects.length, 3);
  const project = result.projects.find((project) => project.locations.includes(repo));
  assert.equal(project.chats, 2);
  assert.deepEqual(project.locations, [repo, tree].sort());
  assert.equal(project.kind, 'repository');
  assert.equal(result.projects.find((project) => project.locations.includes(folder)).chats, 1);
  assert.deepEqual(await snapshot(f.root), before);
});

test('keeps unavailable locations and duplicate views without conflating distinct native chats', async (t) => {
  const f = await fixture(t);
  const gone = path.join(f.root, 'deleted-project');
  await f.session('same-chat', [gone], 'first-view');
  await f.session('same-chat', [gone], 'second-view');
  await f.session('fork-chat', [gone], 'second-view');
  const result = await discoverProjects(['claude-code'], [f.adapter]);
  assert.equal(result.projects.length, 1);
  assert.equal(result.projects[0].kind, 'missing');
  assert.equal(result.projects[0].chats, 2);
  assert.equal(result.projects[0].locations[0], gone);
});

test('does not infer a project from encoded directory names or parse an incomplete final record', async (t) => {
  const f = await fixture(t);
  const file = await f.session('unfinished', [], '-pretend-project-path');
  await fs.writeFile(file, JSON.stringify({ sessionId: 'unfinished', cwd: f.root }));
  let scan = await claudeSessions(f.home);
  assert.equal(scan.coverage, 'partial');
  assert.deepEqual(scan.sessions, []);
  await fs.appendFile(file, '\n');
  scan = await claudeSessions(f.home);
  assert.equal(scan.sessions.length, 1);
  assert.equal(scan.sessions[0].locations[0], f.root);
});

test('bounded prefix, file and directory limits report partial coverage without leaking malformed input', async (t) => {
  const f = await fixture(t);
  await f.session('one', [f.root]);
  await f.session('two', [f.root]);
  const scan = await claudeSessions(f.home, { entries: 100, files: 1, bytes: 1024, prefix: 1024 });
  assert.equal(scan.coverage, 'partial');
  assert.equal(scan.filesRead, 1);
  assert.ok(scan.bytesRead <= 1024);
  const limited = await claudeSessions(f.home, {
    entries: 1,
    files: 100,
    bytes: 1024,
    prefix: 128,
  });
  assert.equal(limited.coverage, 'partial');
  const file = await f.session('malformed', [f.root]);
  await fs.writeFile(file, '{ private-malformed-transcript\n' + 'x'.repeat(80000));
  const invalid = await claudeSessions(f.home);
  assert.equal(invalid.coverage, 'partial');
  assert.ok(!JSON.stringify(invalid).includes('private-malformed-transcript'));
  assert.ok(invalid.bytesRead < 1024 * 1024);
});

test('skips sidechains, symlinked collections/files and unsafe project paths', async (t) => {
  const f = await fixture(t);
  const sidechain = await f.session('child', [f.root]);
  await fs.writeFile(
    sidechain,
    JSON.stringify({ sessionId: 'child', cwd: f.root, isSidechain: true }) + '\n',
  );
  const outside = path.join(f.root, 'outside');
  await fs.mkdir(outside);
  await fs.writeFile(
    path.join(outside, 'external.jsonl'),
    JSON.stringify({ sessionId: 'external', cwd: '/must-not-be-in-result' }) + '\n',
  );
  await fs.symlink(outside, path.join(f.home, 'projects', 'linked-collection'));
  await fs.symlink(
    path.join(outside, 'external.jsonl'),
    path.join(path.dirname(sidechain), 'linked.jsonl'),
  );
  await f.session('unsafe', ['relative/path', '/tmp/unsafe\npath']);
  const result = await discoverProjects(['claude-code'], [f.adapter]);
  assert.equal(result.coverage, 'partial');
  assert.deepEqual(result.projects, []);
  assert.ok(!JSON.stringify(result).includes('must-not-be-in-result'));
});

test('missing/unreadable stores and unsupported capabilities are explicit and never read another client', async (t) => {
  const f = await fixture(t);
  assert.equal((await claudeSessions(path.join(f.root, 'absent'))).coverage, 'not-found');
  await fs.writeFile(path.join(f.root, 'not-directory'), 'fixture');
  assert.equal((await claudeSessions(path.join(f.root, 'not-directory'))).coverage, 'unavailable');
  const sources = [
    {
      ...f.adapter,
      discoverSessions: () => {
        throw new Error('private-error-content');
      },
    },
    { id: 'codex', label: 'Codex' },
  ];
  const unsupported = await discoverProjects(['codex'], sources);
  assert.equal(unsupported.sources[0].coverage, 'unsupported');
  const failed = await discoverProjects(['claude-code'], sources);
  assert.equal(failed.sources[0].coverage, 'unavailable');
  assert.ok(!JSON.stringify(failed).includes('private-error-content'));
  await assert.rejects(discoverProjects(['unknown'], sources), /known clients/);
  await assert.rejects(discoverProjects(['codex', 'codex'], sources), /known clients/);
});

test('project probing ignores inherited Git binding and never executes a configured fsmonitor', async (t) => {
  const f = await fixture(t);
  const actual = path.join(f.root, 'actual');
  const other = path.join(f.root, 'other');
  for (const directory of [actual, other]) {
    await fs.mkdir(directory);
    git(directory, 'init', '-q', '-b', 'master');
  }
  const marker = path.join(f.root, 'must-not-exist');
  git(actual, 'config', 'core.fsmonitor', `touch ${marker}`);
  const previous = process.env.GIT_DIR;
  process.env.GIT_DIR = path.join(other, '.git');
  t.after(() => {
    if (previous === undefined) delete process.env.GIT_DIR;
    else process.env.GIT_DIR = previous;
  });
  await f.session('chat', [actual]);
  const result = await discoverProjects(['claude-code'], [f.adapter]);
  assert.deepEqual(result.projects[0].locations, [actual]);
  await assert.rejects(fs.access(marker));
});

test('more than 32 working locations can finish without a verification-starvation cutoff', async (t) => {
  const f = await fixture(t);
  await f.session(
    'many',
    Array.from({ length: 40 }, (_, index) => path.join(f.root, `missing-${index}`)),
  );
  const result = await discoverProjects(['claude-code'], [f.adapter]);
  assert.equal(result.projects.length, 40);
  assert.equal(result.coverage, 'complete');
  assert.ok(result.projects.every((project) => project.kind === 'missing'));
});

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
  assert.equal((await fetch(`${ui.url}/projects.js`)).status, 200);
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

const limits = { entries: 1000, files: 1000, bytes: 1024 * 1024, prefix: 1024 * 1024 };
const tick = () => new Promise((resolve) => setImmediate(resolve));
const minimalReport = (projects = [], coverage = 'complete') => ({
  metadataOnly: true,
  coverage,
  finished: true,
  checkedAt: new Date().toISOString(),
  sources: [],
  issues: [],
  projects,
});

function isolateEnvironment(t, values) {
  const saved = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  Object.assign(process.env, values);
  t.after(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

async function clientUi(t, f, services = {}) {
  isolateEnvironment(t, {
    AGENT_HUB_HOME: path.join(f.root, 'hub'),
    CLAUDE_CONFIG_DIR: f.home,
    AGENT_HUB_CLAUDE_CONFIG: path.join(f.root, 'claude.json'),
    CODEX_HOME: path.join(f.root, 'codex'),
    DSH_HOME: path.join(f.root, 'absent-dsh'),
    DSH_AGENTS_HOME: path.join(f.root, 'absent-agents'),
    AGENT_HUB_SHARED_SKILLS: path.join(f.root, 'absent-skills'),
  });
  await fs.writeFile(process.env.AGENT_HUB_CLAUDE_CONFIG, '{}');
  const ui = await startUiServer({ port: 0, cwd: f.root, services });
  t.after(() => ui.close());
  const state = await (await fetch(`${ui.url}/api/state`)).json();
  const post = (route, body, token = state.token) =>
    fetch(`${ui.url}${route}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Agent-Hub-Token': token },
      body: JSON.stringify(body),
    });
  return { ui, state, post };
}

async function completed(post, id) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const response = await post('/api/projects/discovery/status', { id });
    assert.equal(response.status, 200);
    const report = await response.json();
    if (report.state !== 'running') return report;
    await tick();
  }
  throw new Error('Fixture scan did not complete');
}

test('exact file, entry and byte thresholds are complete, while genuinely remaining work is partial', async (t) => {
  const f = await fixture(t);
  const file = await f.session('one', [f.root]);
  const bytes = (await fs.stat(file)).size;
  const exact = await claudeSessions(f.home, { ...limits, entries: 2, files: 1, bytes });
  assert.equal(exact.coverage, 'complete');
  assert.equal(exact.finished, true);
  assert.equal(exact.filesRead, 1);
  assert.equal(exact.entriesRead, 2);
  assert.equal(exact.bytesRead, bytes);
  await f.session('two', [f.root]);
  const partial = await claudeSessions(f.home, { ...limits, files: 1 });
  assert.equal(partial.coverage, 'partial');
  assert.equal(partial.finished, false);
  assert.equal(partial.filesRead, 1);
});

test('one run continues beyond four MiB in bounded batches and reaches late collections fairly', async (t) => {
  const f = await fixture(t);
  for (let index = 0; index < 80; index++) {
    const file = await f.session(`large-${index}`, [f.root], 'early-large');
    await fs.appendFile(
      file,
      JSON.stringify({
        type: 'assistant',
        message: { content: 'private-large-body'.repeat(5000) },
      }) + '\n',
    );
  }
  await f.session('late', [f.root], 'late-small');
  const batches = [];
  const report = await claudeSessions(f.home, undefined, {
    onBatch: async (batch) => {
      if (batch.sessions.length) batches.push(batch.sessions.map((session) => session.id));
    },
  });
  assert.equal(report.coverage, 'complete');
  assert.equal(report.filesRead, 81);
  assert.equal(report.totalFiles, 81);
  assert.ok(report.bytesRead > 4 * 1024 * 1024);
  assert.ok(batches.every((batch) => batch.length <= 32));
  assert.ok(batches[0].includes('late'));
  assert.equal(new Set(batches.flat()).size, 81);
  assert.deepEqual(report.sessions, []);
});

test('valid large UTF-8 first records yield metadata without interpreting nested message fields', async (t) => {
  const f = await fixture(t);
  const file = await f.session('large', [f.root]);
  await fs.writeFile(
    file,
    JSON.stringify({
      type: 'user',
      sessionId: 'large',
      cwd: f.root,
      message: { content: '😀'.repeat(30000), cwd: '/decoy-path' },
    }) + '\n',
  );
  const result = await claudeSessions(f.home);
  assert.equal(result.coverage, 'complete');
  assert.ok(result.bytesRead > 64 * 1024);
  assert.deepEqual(result.sessions, [{ id: 'large', locations: [f.root] }]);
  assert.ok(!JSON.stringify(result).includes('😀'));
  await fs.writeFile(
    file,
    JSON.stringify({
      type: 'user',
      sessionId: 'large',
      message: { cwd: '/decoy-path', content: '"cwd":"/fake"' },
    }) + '\n',
  );
  const nested = await claudeSessions(f.home);
  assert.deepEqual(nested.sessions, []);
  assert.equal(nested.unresolvedFiles, 1);
});

test('a corrupt repository or missing Git never becomes a successful ordinary-folder observation', async (t) => {
  const f = await fixture(t);
  const repo = path.join(f.root, 'broken');
  await fs.mkdir(repo);
  git(repo, 'init', '-q', '-b', 'master');
  await fs.writeFile(path.join(repo, '.git', 'config'), '[broken\n');
  await f.session('chat', [repo]);
  const broken = await discoverProjects(['claude-code'], [f.adapter]);
  assert.equal(broken.projects[0].kind, 'unverified');
  assert.equal(broken.coverage, 'partial');
  assert.ok(broken.issues.length);
  const savedPath = process.env.PATH;
  let absent;
  try {
    process.env.PATH = path.join(f.root, 'absent-bin');
    absent = await discoverProjects(['claude-code'], [f.adapter]);
  } finally {
    process.env.PATH = savedPath;
  }
  assert.equal(absent.projects[0].kind, 'unverified');
  assert.equal(absent.coverage, 'partial');
});

test('Git paths with significant trailing spaces remain verified', async (t) => {
  const f = await fixture(t);
  const repo = path.join(f.root, 'project');
  const gitDirectory = path.join(f.root, 'metadata ');
  await fs.mkdir(repo);
  git(repo, 'init', '-q', '-b', 'master', '--separate-git-dir', gitDirectory);
  await f.session('chat', [repo]);
  const result = await discoverProjects(['claude-code'], [f.adapter]);
  assert.equal(result.projects[0].kind, 'repository');
  assert.equal(result.coverage, 'complete');
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

test('excessive observations are explicitly limited instead of producing an unbounded successful response', async (t) => {
  const f = await fixture(t);
  const adapter = {
    ...f.adapter,
    discoverSessions: async () => ({
      source: 'fixture',
      coverage: 'complete',
      finished: true,
      filesRead: 1,
      bytesRead: 1,
      issues: [],
      sessions: [
        {
          id: 'many',
          locations: Array.from({ length: 2100 }, (_, index) =>
            path.join(f.root, `folder-${index}`),
          ),
        },
      ],
    }),
  };
  const result = await discoverProjects(['claude-code'], [adapter]);
  assert.equal(result.projects.length, 2000);
  assert.equal(result.coverage, 'partial');
  assert.equal(result.finished, false);
  assert.match(result.issues.join(' '), /capacity/);
});

test('oversized per-session location metadata is unresolved and never silently counted as complete', async (t) => {
  const f = await fixture(t);
  await f.session(
    'many',
    Array.from({ length: 500 }, (_, index) => path.join(f.root, `folder-${index}`)),
  );
  const scan = await claudeSessions(f.home);
  assert.equal(scan.coverage, 'partial');
  assert.equal(scan.unresolvedFiles, 1);
  assert.equal(scan.sessions.length, 0);
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

test('source cancellation closes its iterators and the next independent scan can finish', async (t) => {
  const f = await fixture(t);
  for (let index = 0; index < 65; index++) await f.session(`chat-${index}`, [f.root]);
  const controller = new AbortController();
  await assert.rejects(
    claudeSessions(f.home, undefined, {
      signal: controller.signal,
      onBatch: async (batch) => {
        if (batch.sessions.length) controller.abort();
      },
    }),
    { name: 'AbortError' },
  );
  const next = await claudeSessions(f.home);
  assert.equal(next.coverage, 'complete');
  assert.equal(next.filesRead, 65);
});

test('collection changes during scanning remain partial until a fresh scan observes the new inventory', async (t) => {
  const f = await fixture(t);
  for (let index = 0; index < 35; index++) await f.session(`chat-${index}`, [f.root]);
  let changed = false;
  const result = await claudeSessions(f.home, undefined, {
    onBatch: async (batch) => {
      if (!changed && batch.sessions.length) {
        changed = true;
        await f.session('added-during-scan', [f.root]);
      }
    },
  });
  assert.equal(result.coverage, 'partial');
  assert.match(result.issues.join(' '), /changed/);
  const next = await claudeSessions(f.home);
  assert.equal(next.filesRead, 36);
  assert.equal(next.coverage, 'complete');
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
