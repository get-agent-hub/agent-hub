import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { discoverProjects } from '../dist/core/projects/discovery.js';
import { fixture, git, snapshot } from './helpers/project-discovery.mjs';

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
