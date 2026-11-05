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
    discoverSessions: () => claudeSessions(home),
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
  assert.deepEqual(await discoverProjects(['claude-code'], [f.adapter]), first);
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
  assert.ok(invalid.bytesRead < 70000);
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

test('location verification is bounded while unverified metadata remains visible', async (t) => {
  const f = await fixture(t);
  await f.session(
    'many',
    Array.from({ length: 40 }, (_, index) => path.join(f.root, `missing-${index}`)),
  );
  const result = await discoverProjects(['claude-code'], [f.adapter]);
  assert.equal(result.projects.length, 40);
  assert.equal(result.coverage, 'partial');
  assert.ok(result.projects.some((project) => project.kind === 'unverified'));
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
