import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { planContextSync } from '../dist/core/instructions/sync.js';
import {
  applyManagedPlan,
  planManagedRestore,
  prepareArtifacts,
  publicManagedPlan,
} from '../dist/core/recovery/managed-plan.js';
import { applyReset, planReset } from '../dist/core/recovery/reset.js';
import { planContent } from '../dist/core/setup/content.js';
import { planRepoInit } from '../dist/core/setup/repo-init.js';
import {
  planSkillAdd,
  planSkillImport,
  planSkillRemove,
  planSkillSync,
} from '../dist/core/skills/skills.js';
import {
  copyArtifact,
  inspectArtifact,
  replaceArtifact,
  writeArtifactTransaction,
} from '../dist/shared/artifacts.js';
import { startUiServer } from '../dist/ui/server.js';

const exec = promisify(execFile);

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ahub-content-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const root = path.join(directory, 'hub');
  await fs.mkdir(path.join(root, 'skills'), { recursive: true });
  await fs.writeFile(path.join(root, 'hub.yaml'), 'version: 1\n');
  const shared = path.join(directory, 'shared', 'skills');
  const clients = ['claude-code', 'codex', 'dsh'].map((id) => ({
    id,
    label: id,
    installed: true,
    skills: id === 'claude-code' ? path.join(directory, id, 'skills') : shared,
    additionalSkills: [],
    instructions: path.join(directory, id, id === 'claude-code' ? 'CLAUDE.md' : 'AGENTS.md'),
  }));
  return { root, clients, directory };
}

async function skill(directory, text = '# Demo skill\n') {
  await fs.mkdir(path.join(directory, 'assets'), { recursive: true });
  await fs.writeFile(
    path.join(directory, 'SKILL.md'),
    `---\nname: ${path.basename(directory)}\ndescription: Fixture skill for isolated integration checks.\n---\n${text}`,
  );
  await fs.writeFile(path.join(directory, 'assets', 'binary.bin'), Buffer.from([0, 255, 1, 0]));
  await fs.writeFile(path.join(directory, 'run.sh'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
}

async function apply(build) {
  const plan = await build();
  return applyManagedPlan(plan, build, plan.revision);
}

test('skill add copies complete source without execution; source edits invalidate preview', async (t) => {
  const context = await fixture(t);
  const source = path.join(context.directory, 'demo');
  await skill(source);
  const build = () => planSkillAdd(source, {}, context);
  const preview = await build();
  assert.equal(preview.requests.length, 1);
  assert.equal((await inspectArtifact(path.join(context.root, 'skills', 'demo'))).kind, 'missing');
  await fs.writeFile(path.join(source, 'SKILL.md'), '# changed\n');
  await assert.rejects(applyManagedPlan(preview, build, preview.revision), /Inputs changed/);
  await apply(build);
  assert.deepEqual(
    await fs.readFile(path.join(context.root, 'skills', 'demo', 'assets', 'binary.bin')),
    Buffer.from([0, 255, 1, 0]),
  );
  assert.equal(
    (await fs.stat(path.join(context.root, 'skills', 'demo', 'run.sh'))).mode & 0o777,
    0o755,
  );
  assert.equal((await build()).requests.length, 0);
});

test('skills import requires source preference for differing copies and never changes client sources', async (t) => {
  const context = await fixture(t);
  const claude = path.join(context.clients[0].skills, 'demo');
  const codex = path.join(context.clients[1].skills, 'demo');
  await skill(claude, '# Claude copy\n');
  await skill(codex, '# Shared copy\n');
  assert.equal((await planSkillImport('skills', {}, context)).blocked, true);
  const build = () => planSkillImport('skills', { prefer: 'codex' }, context);
  const before = await inspectArtifact(codex);
  await apply(build);
  assert.ok(
    (await fs.readFile(path.join(context.root, 'skills', 'demo', 'SKILL.md'), 'utf8')).endsWith(
      '# Shared copy\n',
    ),
  );
  assert.equal((await inspectArtifact(codex)).fingerprint, before.fingerprint);
});

test('skills sync creates one shared link, preserves unrelated skills and is idempotent', async (t) => {
  const context = await fixture(t);
  await skill(path.join(context.root, 'skills', 'demo'));
  await skill(path.join(context.clients[1].skills, 'unrelated'));
  const build = () => planSkillSync({}, context);
  const preview = await build();
  assert.equal(preview.rows.filter((row) => row.name === 'demo').length, 2);
  assert.equal(publicManagedPlan(preview).commands.apply.includes('--expect'), true);
  await assert.rejects(applyManagedPlan(preview, build), /requires --expect/);
  await apply(build);
  for (const client of context.clients)
    assert.equal(
      await fs.realpath(path.join(client.skills, 'demo')),
      await fs.realpath(path.join(context.root, 'skills', 'demo')),
    );
  assert.equal(
    (await inspectArtifact(path.join(context.clients[1].skills, 'unrelated'))).kind,
    'directory',
  );
  assert.equal((await build()).requests.length, 0);
});

test('matching directories become links; restore recovers their complete original data', async (t) => {
  const context = await fixture(t);
  await skill(path.join(context.root, 'skills', 'demo'));
  const clientPath = path.join(context.clients[0].skills, 'demo');
  await skill(clientPath);
  const before = await inspectArtifact(clientPath);
  const result = await apply(() => planSkillSync({}, context));
  assert.equal((await inspectArtifact(clientPath)).kind, 'symlink');
  await apply(() => planManagedRestore(result.backup, context.root));
  assert.equal((await inspectArtifact(clientPath)).fingerprint, before.fingerprint);
  assert.equal(
    (await inspectArtifact(path.join(context.clients[1].skills, 'demo'))).kind,
    'missing',
  );
});

test('reset returns original skill directories and removes newly created links', async (t) => {
  const context = await fixture(t);
  await skill(path.join(context.root, 'skills', 'demo'));
  await skill(path.join(context.clients[0].skills, 'demo'));
  const original = await inspectArtifact(path.join(context.clients[0].skills, 'demo'));
  await apply(() => planSkillSync({}, context));
  const plan = await planReset({}, context.root);
  assert.equal(plan.blocked, false);
  await applyReset(plan, plan.revision);
  assert.equal((await inspectArtifact(original.path)).fingerprint, original.fingerprint);
  assert.equal(
    (await inspectArtifact(path.join(context.clients[1].skills, 'demo'))).kind,
    'missing',
  );
});

test('modified and repointed client links block restore/reset, including archive-changes', async (t) => {
  const context = await fixture(t);
  await skill(path.join(context.root, 'skills', 'demo'));
  const result = await apply(() => planSkillSync({}, context));
  const clientPath = path.join(context.clients[0].skills, 'demo');
  await fs.unlink(clientPath);
  await fs.symlink(context.directory, clientPath);
  assert.equal((await planManagedRestore(result.backup, context.root)).blocked, true);
  assert.equal((await planReset({ archiveChanges: true }, context.root)).blocked, true);
});

test('differing client skills and shadowed local skills are conflicts; disabled shared clients stay protected', async (t) => {
  const context = await fixture(t);
  await skill(path.join(context.root, 'skills', 'demo'));
  await skill(path.join(context.clients[0].skills, 'demo'), '# Different\n');
  assert.equal((await planSkillSync({}, context)).blocked, true);
  await fs.rm(path.join(context.clients[0].skills, 'demo'), { recursive: true });
  context.clients[1].additionalSkills = [path.join(context.directory, 'codex-own')];
  await skill(path.join(context.clients[1].additionalSkills[0], 'demo'), '# Local override\n');
  assert.equal((await planSkillSync({ client: 'codex' }, context)).blocked, true);
  context.clients[1].additionalSkills = [];
  await fs.writeFile(
    path.join(context.root, 'hub.yaml'),
    'version: 1\nclients:\n  dsh:\n    enabled: false\n',
  );
  assert.equal((await planSkillSync({ client: 'codex' }, context)).blocked, true);
});

test('removing hub skill cleans only unchanged owned links on the next sync', async (t) => {
  const context = await fixture(t);
  await skill(path.join(context.root, 'skills', 'demo'));
  await apply(() => planSkillSync({}, context));
  await apply(() => planSkillRemove('demo', context));
  const plan = await planSkillSync({}, context);
  assert.equal(plan.rows.filter((row) => row.action === 'remove').length, 2);
  await apply(() => planSkillSync({}, context));
  assert.equal(
    (await inspectArtifact(path.join(context.clients[0].skills, 'demo'))).kind,
    'missing',
  );
  await assert.rejects(planSkillRemove('../escape', context), /skill name/);
});

test('escaping asset symlinks and recursive source copies fail without writing destinations', async (t) => {
  const context = await fixture(t);
  const source = path.join(context.directory, 'source');
  await skill(source);
  await fs.symlink('../../outside', path.join(source, 'assets', 'escape'));
  await assert.rejects(planSkillAdd(source, {}, context), /escaping symlink/);
  await fs.unlink(path.join(source, 'assets', 'escape'));
  await assert.rejects(copyArtifact(source, path.join(source, 'child')), /into itself/);
});

test('artifact transaction rolls back prior replacements after a later write fails', async (t) => {
  const context = await fixture(t);
  const one = path.join(context.directory, 'one');
  const two = path.join(context.directory, 'two');
  await skill(one);
  await skill(two);
  const before = await inspectArtifact(one);
  const requests = await Promise.all(
    [one, two].map(async (file) => ({
      before: await inspectArtifact(file),
      client: 'fixture',
      value: { kind: 'file', content: 'replacement\n', mode: 0o600 },
    })),
  );
  const changes = await prepareArtifacts(context.directory, requests);
  assert.equal(changes.length, 2);
  let writes = 0;
  await assert.rejects(
    writeArtifactTransaction(changes, async (snapshot, source) => {
      if (++writes === 2) throw new Error('injected I/O failure');
      await replaceArtifact(snapshot, source);
    }),
    /rolled back/,
  );
  assert.equal((await inspectArtifact(one)).fingerprint, before.fingerprint);
});

async function sharedContext(context) {
  await fs.mkdir(path.join(context.root, 'instructions'), { recursive: true });
  await fs.mkdir(path.join(context.root, 'memory'), { recursive: true });
  await fs.writeFile(
    path.join(context.root, 'instructions', 'AGENTS.md'),
    'Shared rule: preserve project conventions.\n',
  );
  await fs.writeFile(
    path.join(context.root, 'memory', 'MEMORY.md'),
    '- [Preferences](preferences.md)\nPRIVATE_CONTEXT_TOKEN\n',
  );
  await fs.writeFile(path.join(context.root, 'memory', 'preferences.md'), '# Preferences\n');
}

test('context delivery uses Claude imports and embeds rules/index for Codex and DSH without exposing text in previews', async (t) => {
  const context = await fixture(t);
  await sharedContext(context);
  for (const client of context.clients) {
    await fs.mkdir(path.dirname(client.instructions), { recursive: true });
    await fs.writeFile(client.instructions, 'Personal rules stay here.\n');
  }
  const build = () => planContextSync({}, context);
  assert.ok(!JSON.stringify(publicManagedPlan(await build())).includes('PRIVATE_CONTEXT_TOKEN'));
  await apply(build);
  const claude = await fs.readFile(context.clients[0].instructions, 'utf8');
  assert.ok(claude.startsWith('Personal rules stay here.\n'));
  assert.ok(claude.includes('@' + path.join(context.root, 'instructions', 'AGENTS.md')));
  assert.ok(!claude.includes('PRIVATE_CONTEXT_TOKEN'));
  assert.ok(
    (await fs.readFile(context.clients[1].instructions, 'utf8')).includes('PRIVATE_CONTEXT_TOKEN'),
  );
  assert.equal((await build()).requests.length, 0);
  await fs.appendFile(context.clients[1].instructions, 'Additional personal rule.\n');
  await fs.writeFile(
    path.join(context.root, 'instructions', 'AGENTS.md'),
    'Updated shared rules.\n',
  );
  await apply(build);
  const codex = await fs.readFile(context.clients[1].instructions, 'utf8');
  assert.ok(codex.endsWith('Additional personal rule.\n'));
  assert.ok(codex.includes('Updated shared rules.'));
});

test('edited blocks, overrides, oversized output and symlink instruction targets block context delivery', async (t) => {
  const context = await fixture(t);
  await sharedContext(context);
  await apply(() => planContextSync({}, context));
  const file = context.clients[1].instructions;
  await fs.writeFile(
    file,
    (await fs.readFile(file, 'utf8')).replace('Shared rule:', 'Edited owned rule:'),
  );
  assert.equal((await planContextSync({}, context)).blocked, true);
  await fs.writeFile(path.join(path.dirname(file), 'AGENTS.override.md'), 'Override rules\n');
  assert.ok(
    (await planContextSync({ client: 'codex' }, context)).rows.some((row) =>
      row.note?.includes('shadows'),
    ),
  );
  await fs.unlink(context.clients[0].instructions);
  await fs.symlink(file, context.clients[0].instructions);
  assert.equal((await planContextSync({ client: 'claude-code' }, context)).blocked, true);
  await fs.writeFile(path.join(context.root, 'instructions', 'AGENTS.md'), 'x'.repeat(33 * 1024));
  assert.equal((await planContextSync({ client: 'dsh' }, context)).blocked, true);
});

test('context stale previews reject changes and reset restores original instructions', async (t) => {
  const context = await fixture(t);
  await sharedContext(context);
  const original = context.clients[0].instructions;
  await fs.mkdir(path.dirname(original), { recursive: true });
  await fs.writeFile(original, 'Original Claude rules.\n');
  const build = () => planContextSync({}, context);
  const preview = await build();
  await fs.appendFile(original, 'New user rule.\n');
  await assert.rejects(applyManagedPlan(preview, build, preview.revision), /Inputs changed/);
  await apply(build);
  const reset = await planReset({}, context.root);
  await applyReset(reset, reset.revision);
  assert.equal(await fs.readFile(original, 'utf8'), 'Original Claude rules.\nNew user rule.\n');
  assert.equal((await inspectArtifact(context.clients[1].instructions)).kind, 'missing');
});

test('empty context does not write files; removing sources removes only managed text', async (t) => {
  const context = await fixture(t);
  assert.equal((await planContextSync({}, context)).requests.length, 0);
  await sharedContext(context);
  await apply(() => planContextSync({}, context));
  const file = context.clients[1].instructions;
  await fs.appendFile(file, 'Retain this user note.\n');
  await fs.rm(path.join(context.root, 'instructions'), { recursive: true });
  await fs.rm(path.join(context.root, 'memory'), { recursive: true });
  await apply(() => planContextSync({}, context));
  assert.equal((await fs.readFile(file, 'utf8')).trim(), 'Retain this user note.');
  assert.equal((await inspectArtifact(context.clients[0].instructions)).kind, 'missing');
});

test('init-repo preserves existing instructions and notes, is idempotent and never commits Git work', async (t) => {
  const context = await fixture(t);
  const repo = path.join(context.directory, 'project');
  await fs.mkdir(path.join(repo, '.agents', 'state'), { recursive: true });
  await exec('git', ['init', '-q', repo]);
  await fs.writeFile(path.join(repo, 'AGENTS.md'), '# Existing project rules\n');
  await fs.writeFile(path.join(repo, 'CLAUDE.md'), '# Claude rules\n```\n@AGENTS.md\n```\n');
  await fs.writeFile(
    path.join(repo, '.agents', 'state', 'PROJECT.md'),
    'Human architecture notes.\n',
  );
  await fs.writeFile(path.join(repo, '.agents', 'state', 'NOW.md'), 'Human task notes.\n');
  const build = () => planRepoInit(repo, context);
  await apply(build);
  assert.ok(
    (await fs.readFile(path.join(repo, 'AGENTS.md'), 'utf8')).startsWith(
      '# Existing project rules\n',
    ),
  );
  assert.ok((await fs.readFile(path.join(repo, 'CLAUDE.md'), 'utf8')).endsWith('@AGENTS.md\n'));
  assert.equal(
    await fs.readFile(path.join(repo, '.agents', 'state', 'NOW.md'), 'utf8'),
    'Human task notes.\n',
  );
  assert.equal((await build()).requests.length, 0);
  assert.ok(
    (await exec('git', ['status', '--porcelain'], { cwd: repo })).stdout.includes('?? AGENTS.md'),
  );
  const reset = await planReset({}, context.root);
  await applyReset(reset, reset.revision);
  assert.equal(
    await fs.readFile(path.join(repo, 'AGENTS.md'), 'utf8'),
    '# Existing project rules\n',
  );
});

test('init-repo supports custom templates, protects changed task notes on reset and rejects non-repositories', async (t) => {
  const context = await fixture(t);
  const repo = path.join(context.directory, 'new-project');
  await fs.mkdir(repo);
  await exec('git', ['init', '-q', repo]);
  await fs.mkdir(path.join(context.root, 'templates', 'repo'), { recursive: true });
  await fs.writeFile(
    path.join(context.root, 'templates', 'repo', 'AGENTS.md'),
    'Custom project workflow.\n',
  );
  await apply(() => planRepoInit(repo, context));
  assert.ok(
    (await fs.readFile(path.join(repo, 'AGENTS.md'), 'utf8')).includes('Custom project workflow.'),
  );
  assert.ok(
    (await fs.readFile(path.join(repo, '.agents', 'state', 'NOW.md'), 'utf8')).includes(
      'No project checks were run',
    ),
  );
  await fs.appendFile(path.join(repo, '.agents', 'state', 'NOW.md'), 'Actual work in progress.\n');
  assert.equal((await planReset({}, context.root)).blocked, true);
  const reset = await planReset({ archiveChanges: true }, context.root);
  await applyReset(reset, reset.revision);
  assert.equal((await inspectArtifact(path.join(repo, 'AGENTS.md'))).kind, 'missing');
  assert.equal((await inspectArtifact(path.join(repo, '.agents'))).kind, 'missing');
  await assert.rejects(planRepoInit(context.directory, context), /existing Git repository/);
});

test('explicit skill replacement covers client-local shadow copies and later Hub edits stay live', async (t) => {
  const context = await fixture(t);
  const own = path.join(context.directory, 'codex-own');
  context.clients[1].additionalSkills = [own];
  await skill(path.join(context.root, 'skills', 'demo'));
  await skill(path.join(own, 'demo'), '# Different local version\n');
  assert.equal((await planSkillSync({ client: 'codex' }, context)).blocked, true);
  await apply(() => planSkillSync({ client: 'codex', replace: ['demo'] }, context));
  assert.equal((await inspectArtifact(path.join(own, 'demo'))).kind, 'symlink');
  await fs.writeFile(
    path.join(context.root, 'skills', 'demo', 'SKILL.md'),
    '---\nname: demo\ndescription: Updated fixture skill.\n---\n# Updated centrally\n',
  );
  assert.equal(
    await fs.readFile(path.join(own, 'demo', 'SKILL.md'), 'utf8'),
    '---\nname: demo\ndescription: Updated fixture skill.\n---\n# Updated centrally\n',
  );
  assert.equal((await planSkillSync({ client: 'codex' }, context)).requests.length, 0);
});

test('a source change during artifact writes rolls earlier updates back without re-running the failed source guard', async (t) => {
  const context = await fixture(t);
  const file = path.join(context.directory, 'guarded');
  await fs.writeFile(file, 'original');
  const before = await inspectArtifact(file);
  const changes = await prepareArtifacts(context.directory, [
    { before, client: 'fixture', value: { kind: 'file', content: 'new', mode: 0o600 } },
  ]);
  let checks = 0;
  await assert.rejects(
    writeArtifactTransaction(changes, undefined, async () => {
      if (++checks > 1) throw new Error('Source changed');
    }),
    /rolled back/,
  );
  assert.equal((await inspectArtifact(file)).fingerprint, before.fingerprint);
});

test('content HTTP previews redact source text, require a token, reject stale inputs and are single-use', async (t) => {
  const context = await fixture(t);
  await sharedContext(context);
  const ui = await startUiServer({
    port: 0,
    services: {
      state: async () => ({}),
      contentPlan: (operation, options) =>
        planContent(operation, options, context.directory, context),
    },
  });
  t.after(() => ui.close());
  const token = (await (await fetch(ui.url + '/api/state')).json()).token;
  const post = (endpoint, body, authenticated = true) =>
    fetch(ui.url + '/api/content/' + endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(authenticated ? { 'x-agent-hub-token': token } : {}),
      },
      body: JSON.stringify(body),
    });
  assert.equal((await post('preview', { operation: 'context-sync' }, false)).status, 403);
  assert.equal((await post('preview', { operation: 'not-real' })).status, 409);
  let preview = await (await post('preview', { operation: 'context-sync' })).json();
  assert.ok(!JSON.stringify(preview).includes('PRIVATE_CONTEXT_TOKEN'));
  assert.equal((await inspectArtifact(context.clients[0].instructions)).kind, 'missing');
  await fs.writeFile(
    path.join(context.root, 'instructions', 'AGENTS.md'),
    'Changed after preview.\n',
  );
  assert.equal((await post('apply', { id: preview.id })).status, 409);
  preview = await (await post('preview', { operation: 'context-sync' })).json();
  assert.equal((await post('apply', { id: preview.id })).status, 200);
  assert.equal((await post('apply', { id: preview.id })).status, 409);
  assert.equal((await inspectArtifact(context.clients[0].instructions)).kind, 'file');
});

test('production CLI supports skills, context, repo setup and copied restore commands in isolated client homes', async (t) => {
  const context = await fixture(t);
  await sharedContext(context);
  const homes = Object.fromEntries(
    context.clients.map((client) => [client.id, path.dirname(client.skills)]),
  );
  homes.codex = path.join(context.directory, 'codex-home');
  homes.dsh = path.join(context.directory, 'dsh-home');
  for (const home of Object.values(homes)) await fs.mkdir(home, { recursive: true });
  const env = {
    ...process.env,
    AGENT_HUB_HOME: context.root,
    CLAUDE_CONFIG_DIR: homes['claude-code'],
    AGENT_HUB_CLAUDE_CONFIG: path.join(homes['claude-code'], 'config.json'),
    CODEX_HOME: homes.codex,
    DSH_HOME: homes.dsh,
    AGENT_HUB_SHARED_SKILLS: context.clients[1].skills,
  };
  const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
  const run = async (args) =>
    JSON.parse(
      (await exec(process.execPath, [cli, ...args, '--json'], { env, cwd: context.directory }))
        .stdout,
    );
  const source = path.join(context.directory, 'cli-demo');
  await skill(source);
  const add = await run(['skill', 'add', source]);
  await exec('sh', ['-c', add.commands.apply], { env, cwd: context.directory });
  assert.equal((await run(['skill', 'ls'])).skills.length, 1);
  const sync = await run(['sync', '--area', 'skills']);
  assert.equal(sync.dryRun, true);
  const applied = await run(['sync', '--area', 'skills', '--apply', '--expect', sync.revision]);
  const rollback = await run(['restore', applied.result.backup]);
  await exec('sh', ['-c', rollback.commands.apply], { env, cwd: context.directory });
  assert.equal(
    (await inspectArtifact(path.join(context.clients[1].skills, 'cli-demo'))).kind,
    'missing',
  );
  const contextual = await run(['sync', '--area', 'context']);
  await exec('sh', ['-c', contextual.commands.apply], { env, cwd: context.directory });
  assert.ok(
    (await fs.readFile(path.join(homes.codex, 'AGENTS.md'), 'utf8')).includes(
      'Shared instructions',
    ),
  );
  const repo = path.join(context.directory, 'cli-project');
  await fs.mkdir(repo);
  await exec('git', ['init', '-q', repo]);
  const init = await run(['init-repo', repo]);
  await exec('sh', ['-c', init.commands.apply], { env, cwd: context.directory });
  assert.equal((await run(['init-repo', repo])).changes, 0);
});

test('portable metadata is required before delivering a legacy plain skill to Codex', async (t) => {
  const context = await fixture(t);
  await skill(path.join(context.root, 'skills', 'legacy'));
  await fs.writeFile(
    path.join(context.root, 'skills', 'legacy', 'SKILL.md'),
    '# Claude-only legacy instructions\n',
  );
  assert.equal((await planSkillSync({ client: 'codex' }, context)).blocked, true);
  assert.equal((await planSkillSync({ client: 'claude-code' }, context)).blocked, false);
});

test('Claude account-managed skill namespaces are skipped and never imported or overwritten', async (t) => {
  const context = await fixture(t);
  const managed = path.join(context.clients[0].skills, 'synced');
  await fs.mkdir(path.join(managed, 'downloaded-skill'), { recursive: true });
  await fs.writeFile(
    path.join(managed, 'downloaded-skill', 'SKILL.md'),
    'Account-managed content.',
  );
  await skill(path.join(context.root, 'skills', 'synced'));
  await skill(path.join(context.root, 'skills', 'anthropic-skills'));
  const before = await inspectArtifact(managed);
  const imported = await planSkillImport('skills', {}, context);
  assert.ok(!imported.rows.some((row) => row.name === 'synced'));
  const sync = await planSkillSync({ client: 'claude-code' }, context);
  assert.ok(sync.rows.every((row) => row.action === 'skip'));
  await apply(() => planSkillSync({ client: 'claude-code' }, context));
  assert.equal((await inspectArtifact(managed)).fingerprint, before.fingerprint);
});

test('Hub and client links to equivalent existing originals are not false conflicts and reset restores bindings', async (t) => {
  const context = await fixture(t);
  const original = path.join(context.directory, 'canonical', 'demo');
  await skill(original);
  await fs.symlink(original, path.join(context.root, 'skills', 'demo'));
  for (const directory of new Set(context.clients.map((client) => client.skills))) {
    await fs.mkdir(directory, { recursive: true });
    await fs.symlink(original, path.join(directory, 'demo'));
  }
  assert.equal((await planSkillImport('skills', {}, context)).requests.length, 0);
  assert.equal((await planSkillAdd(original, {}, context)).requests.length, 0);
  const build = () => planSkillSync({}, context);
  const plan = await build();
  assert.equal(plan.blocked, false);
  assert.equal(plan.rows.filter((row) => row.action === 'replace').length, 2);
  await apply(build);
  for (const directory of new Set(context.clients.map((client) => client.skills)))
    assert.equal(
      await fs.readlink(path.join(directory, 'demo')),
      path.join(context.root, 'skills', 'demo'),
    );
  const reset = await planReset({}, context.root);
  await applyReset(reset, reset.revision);
  for (const directory of new Set(context.clients.map((client) => client.skills)))
    assert.equal(await fs.readlink(path.join(directory, 'demo')), original);
  assert.equal((await inspectArtifact(original)).kind, 'directory');
});

test('a client-linked original changing after review invalidates equivalent-link migration', async (t) => {
  const context = await fixture(t);
  const original = path.join(context.directory, 'external', 'demo');
  await skill(original);
  await skill(path.join(context.root, 'skills', 'demo'));
  await fs.mkdir(context.clients[0].skills, { recursive: true });
  await fs.symlink(original, path.join(context.clients[0].skills, 'demo'));
  const build = () => planSkillSync({ client: 'claude-code' }, context);
  const before = await build();
  assert.equal(before.blocked, false);
  await fs.appendFile(path.join(original, 'SKILL.md'), 'New local work.\n');
  await assert.rejects(applyManagedPlan(before, build, before.revision), /Inputs changed/);
  assert.equal(await fs.readlink(path.join(context.clients[0].skills, 'demo')), original);
});

test('shared directory and links pointing into it can migrate together without treating planned replacements as source edits', async (t) => {
  const context = await fixture(t);
  await skill(path.join(context.root, 'skills', 'demo'));
  const shared = path.join(context.clients[1].skills, 'demo');
  await skill(shared);
  await fs.mkdir(context.clients[0].skills, { recursive: true });
  await fs.symlink(shared, path.join(context.clients[0].skills, 'demo'));
  const build = () => planSkillSync({}, context);
  assert.equal((await build()).blocked, false);
  await apply(build);
  assert.equal((await build()).requests.length, 0);
  const reset = await planReset({}, context.root);
  await applyReset(reset, reset.revision);
  assert.equal((await inspectArtifact(shared)).kind, 'directory');
  assert.equal(await fs.readlink(path.join(context.clients[0].skills, 'demo')), shared);
});

test('failed hub installation during reset compensates already restored skill directories', async (t) => {
  const context = await fixture(t);
  await skill(path.join(context.root, 'skills', 'demo'));
  await skill(path.join(context.clients[0].skills, 'demo'));
  await apply(() => planSkillSync({}, context));
  const before = await inspectArtifact(path.join(context.clients[0].skills, 'demo'));
  const reset = await planReset({}, context.root);
  const rename = fs.rename;
  fs.rename = async (source, destination) => {
    if (String(source).endsWith('original-hub') && destination === context.root)
      throw Object.assign(new Error('injected install failure'), { code: 'EIO' });
    return rename(source, destination);
  };
  try {
    await assert.rejects(applyReset(reset, reset.revision), /rolled back/);
  } finally {
    fs.rename = rename;
  }
  assert.equal((await inspectArtifact(before.path)).fingerprint, before.fingerprint);
});

test('corrupt artifact originals and foreign recovery links stop before changing live skills', async (t) => {
  const context = await fixture(t);
  await skill(path.join(context.root, 'skills', 'demo'));
  await skill(path.join(context.clients[0].skills, 'demo'));
  await apply(() => planSkillSync({}, context));
  const file = path.join(context.clients[0].skills, 'demo');
  const before = await inspectArtifact(file);
  const storage = `${context.root}.recovery/artifacts`;
  const manifest = JSON.parse(await fs.readFile(path.join(storage, 'manifest.json'), 'utf8'));
  const original = manifest.entries.find((entry) => entry.before.path === file);
  await fs.writeFile(path.join(storage, original.payload, 'SKILL.md'), 'corrupted');
  await assert.rejects(planReset({}, context.root), /integrity/);
  assert.equal((await inspectArtifact(file)).fingerprint, before.fingerprint);
  const foreign = path.join(context.directory, 'foreign');
  await fs.mkdir(foreign);
  await fs.writeFile(path.join(foreign, 'keep.txt'), 'Unrelated data.');
  await fs.rename(storage, `${storage}-retained`);
  await fs.symlink(foreign, storage);
  await assert.rejects(planReset({}, context.root), /real directory/);
  assert.equal(await fs.readFile(path.join(foreign, 'keep.txt'), 'utf8'), 'Unrelated data.');
});

test('one-client skill import and item delivery preserve unrelated bundles and ownership', async (t) => {
  const context = await fixture(t);
  for (const client of context.clients.slice(0, 2))
    await skill(path.join(client.skills, 'demo'), `# ${client.id}\n`);
  await apply(() => planSkillImport('skills:demo', { source: 'codex', overwrite: true }, context));
  assert.match(
    await fs.readFile(path.join(context.root, 'skills/demo/SKILL.md'), 'utf8'),
    /# codex/,
  );
  await skill(path.join(context.root, 'skills/extra'));
  await apply(() => planSkillSync({ client: 'claude-code', replace: ['demo'] }, context));
  const ownership = await fs.readFile(path.join(context.root, 'state/skills.json'), 'utf8');
  const extra = await inspectArtifact(path.join(context.clients[0].skills, 'extra'));
  await fs.rm(path.join(context.root, 'skills/extra'), { recursive: true });
  const build = () => planSkillSync({ client: 'claude-code', only: ['demo'] }, context);
  const plan = await build();
  assert.equal(
    plan.rows.some((row) => row.name === 'extra'),
    false,
  );
  await apply(build);
  assert.equal((await inspectArtifact(extra.path)).fingerprint, extra.fingerprint);
  assert.equal(await fs.readFile(path.join(context.root, 'state/skills.json'), 'utf8'), ownership);
  assert.equal(
    (await planSkillSync({ client: 'claude-code' }, context)).rows.find(
      (row) => row.name === 'extra',
    ).action,
    'remove',
  );
});
