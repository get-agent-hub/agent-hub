import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import {
  applyManagedPlan,
  planManagedRestore,
  publicManagedPlan,
} from '../dist/core/managed-plan.js';
import { planMemoryProject, memoryLocation } from '../dist/core/memory-projects.js';
import { queryMemory } from '../dist/core/memory-store.js';
import { planMemoryMutation, getMemory } from '../dist/core/memory.js';
import { planAutomationSetup, planAutomationDisable } from '../dist/core/memory-auto-setup.js';
import { planNativeSync, syncNativeAutomatically } from '../dist/core/memory-auto-sync.js';
import { memoryHook, automaticCheckpoint } from '../dist/core/memory-auto-runtime.js';
import { autoStatus } from '../dist/core/memory-auto-status.js';
import { hash } from '../dist/core/values.js';

const exec = promisify(execFile);
const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
const at = '2026-01-01T00:00:00.000Z';
async function apply(build) {
  const plan = await build();
  return applyManagedPlan(plan, build, plan.revision);
}
async function fixture(t) {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'ahub-auto-'));
  const directory = await fs.realpath(temporary);
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const root = path.join(directory, 'hub');
  const workspace = path.join(directory, 'project');
  const native = path.join(directory, 'native');
  await Promise.all([root, workspace, native].map((folder) => fs.mkdir(folder)));
  await fs.writeFile(path.join(root, 'hub.yaml'), 'version: 1\n');
  await exec('git', ['init', '-q', workspace]);
  await apply(() => planMemoryProject(root, 'demo', workspace));
  return {
    root,
    workspace,
    native,
    directory,
    context: { root, selector: { workspace } },
    hooks: (client) => path.join(directory, `${client}-hooks.json`),
    patch: path.join(directory, 'cordis.patch.yml'),
  };
}
async function enable(f, client = 'claude-code', native = f.native) {
  return apply(() =>
    planAutomationSetup(f.root, f.workspace, client, {
      hookFile: f.hooks(client),
      dshPatch: f.patch,
      ...(native ? { nativeDir: native } : {}),
    }),
  );
}
async function records(f) {
  return (await queryMemory([await memoryLocation(f.root, { workspace: f.workspace })], '', 100))
    .results;
}
const payload = (f, name, extra = {}) => ({
  cwd: f.workspace,
  session_id: 'fixture-session',
  hook_event_name: name,
  ...extra,
});
function tokenOf(result) {
  return /checkpoint:([a-f0-9]{32})/.exec(result.reason ?? '')?.[1];
}
const fact = (key = 'retry-rule', body = 'Use idempotency keys for retries.') => ({
  key,
  title: 'API retry policy',
  body,
  kind: 'lesson',
  evidence: 'Verified API contract and user correction.',
});

test('automation setup preserves unrelated native hooks/settings and is idempotent', async (t) => {
  const f = await fixture(t);
  await fs.writeFile(
    f.hooks('claude-code'),
    JSON.stringify({
      theme: 'dark',
      hooks: { Stop: [{ hooks: [{ type: 'command', command: 'existing-user-hook' }] }] },
    }),
  );
  const build = () =>
    planAutomationSetup(f.root, f.workspace, 'claude-code', {
      hookFile: f.hooks('claude-code'),
      nativeDir: f.native,
    });
  const plan = await build();
  assert.equal((await autoStatus(f.root, f.workspace)).policy.enabled, false);
  assert.equal(JSON.stringify(publicManagedPlan(plan)).includes('existing-user-hook'), false);
  await apply(build);
  const config = JSON.parse(await fs.readFile(f.hooks('claude-code'), 'utf8'));
  assert.equal(config.theme, 'dark');
  assert.equal(config.hooks.Stop[0].hooks[0].command, 'existing-user-hook');
  assert.equal(config.hooks.Stop.length, 2);
  assert.equal((await build()).requests.length, 0);
  await enable(f, 'codex', null);
  assert.equal((await build()).requests.length, 0);
  config.hooks.Stop.pop();
  await fs.writeFile(f.hooks('claude-code'), JSON.stringify(config));
  await assert.rejects(build(), /edited, removed or duplicated/);
  await fs.unlink(path.join(f.root, 'memory', 'automation-hooks.json'));
  await assert.rejects(build(), /without ownership/);
});

test('DSH setup writes a valid insert patch and keeps unrelated plugins and comments', async (t) => {
  const f = await fixture(t);
  await fs.writeFile(
    f.patch,
    '# Personal profile\n- insert:\n    - name: unrelated-plugin\n      id: keep-me\n',
  );
  await enable(f, 'dsh');
  const text = await fs.readFile(f.patch, 'utf8');
  assert.match(text, /# Personal profile/);
  assert.match(text, /keep-me/);
  assert.match(text, /insert:[\s\S]*file:\/\/.*\/integrations\/dsh-memory\.js/);
  assert.match(text, /id: agent-hub-memory-hooks/);
  assert.equal(text.includes('@deepseek-ai/dsh-hooks-claude-code'), false);
  await assert.rejects(fs.access(f.hooks('dsh')), { code: 'ENOENT' });
  assert.equal(
    (
      await planAutomationSetup(f.root, f.workspace, 'dsh', {
        hookFile: f.hooks('dsh'),
        dshPatch: f.patch,
        nativeDir: f.native,
      })
    ).requests.length,
    0,
  );
});

test('native sync imports atomic notes, skips indexes, deduplicates content and never changes sources', async (t) => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.native, 'MEMORY.md'), '# Index\n- [Retry rule](retry.md)\n');
  const note = '---\nname: Retry rule\ntype: feedback\n---\nUse idempotency keys for retries.\n';
  await fs.writeFile(path.join(f.native, 'retry.md'), note);
  await fs.writeFile(path.join(f.native, 'duplicate.md'), note);
  await fs.writeFile(
    path.join(f.native, 'notes.md'),
    '# Notes\n\n## Authentication\nUse project credentials.\n\n## Pagination\nFollow the next cursor.\n',
  );
  await enable(f);
  const result = await syncNativeAutomatically(f.root, f.workspace);
  assert.ok(result.changedPaths > 0);
  assert.equal((await records(f)).length, 3);
  assert.equal(
    (await records(f)).some((record) => record.title === 'Retry rule' && record.kind === 'lesson'),
    true,
  );
  assert.equal(await fs.readFile(path.join(f.native, 'retry.md'), 'utf8'), note);
  assert.equal((await syncNativeAutomatically(f.root, f.workspace)).changedPaths, 0);
});

test('native source updates retain record identity and can be restored with their source binding/index', async (t) => {
  const f = await fixture(t);
  const file = path.join(f.native, 'retry.md');
  await fs.writeFile(file, '# Retry rule\nUse idempotency keys.\n');
  await enable(f);
  await syncNativeAutomatically(f.root, f.workspace);
  const original = await getMemory(f.context, (await records(f))[0].id);
  await fs.writeFile(file, '# Updated retry title\nUse a fresh key for every logical operation.\n');
  const result = await syncNativeAutomatically(f.root, f.workspace);
  assert.equal((await records(f))[0].id, original.id);
  assert.equal((await records(f))[0].title, 'Updated retry title');
  assert.match((await getMemory(f.context, original.id)).body, /fresh key/);
  await apply(() => planManagedRestore(result.backup, f.root));
  assert.deepEqual(await getMemory(f.context, original.id), original);
});

test('manual memory edits queue source conflicts; only an explicit reviewed resolution overwrites them', async (t) => {
  const f = await fixture(t);
  const source = path.join(f.native, 'retry.md');
  await fs.writeFile(source, '# Retry rule\nInitial native fact.\n');
  await enable(f);
  await syncNativeAutomatically(f.root, f.workspace);
  const original = await getMemory(f.context, (await records(f))[0].id);
  const editedAt = new Date().toISOString();
  await apply(() =>
    planMemoryMutation(f.context, {
      operation: 'update',
      id: original.id,
      body: 'Personal correction.',
      at: editedAt,
      recordRevision: original.revision,
    }),
  );
  await fs.writeFile(source, '# Retry rule\nChanged native fact.\n');
  const conflicted = await syncNativeAutomatically(f.root, f.workspace);
  assert.equal(conflicted.conflicts, 1);
  assert.equal((await getMemory(f.context, original.id)).body, 'Personal correction.');
  assert.equal((await autoStatus(f.root, f.workspace)).conflicts.length, 1);
  assert.equal((await syncNativeAutomatically(f.root, f.workspace)).changedPaths, 0);
  const now = new Date().toISOString();
  await apply(() => planNativeSync(f.root, f.workspace, now, [original.id]));
  assert.equal((await getMemory(f.context, original.id)).body, 'Changed native fact.');
  assert.equal((await autoStatus(f.root, f.workspace)).conflicts.length, 0);
});

test('deduplication never claims ownership of a manually created equivalent fact', async (t) => {
  const f = await fixture(t);
  await apply(() =>
    planMemoryMutation(f.context, {
      operation: 'create',
      id: 'personal',
      title: 'My fact',
      body: 'Same durable knowledge.',
      at,
    }),
  );
  const file = path.join(f.native, 'note.md');
  await fs.writeFile(file, '# Native note\nSame durable knowledge.\n');
  await enable(f);
  await syncNativeAutomatically(f.root, f.workspace);
  assert.equal((await records(f)).length, 1);
  await fs.writeFile(file, '# Native note\nNew knowledge from the native source.\n');
  await syncNativeAutomatically(f.root, f.workspace);
  assert.equal((await getMemory(f.context, 'personal')).body, 'Same durable knowledge.');
  assert.equal((await records(f)).length, 1);
  assert.equal((await autoStatus(f.root, f.workspace)).conflicts.length, 1);
  assert.equal((await syncNativeAutomatically(f.root, f.workspace)).changedPaths, 0);
});

test('source deletion preserves learned facts and deleting an owned fact does not silently resurrect it', async (t) => {
  const f = await fixture(t);
  const file = path.join(f.native, 'note.md');
  await fs.writeFile(file, '# Note\nDurable knowledge.\n');
  await enable(f);
  await syncNativeAutomatically(f.root, f.workspace);
  const record = await getMemory(f.context, (await records(f))[0].id);
  await fs.unlink(file);
  await syncNativeAutomatically(f.root, f.workspace);
  assert.equal((await records(f)).length, 1);
  await fs.writeFile(file, '# Note\nDurable knowledge.\n');
  const deletedAt = new Date().toISOString();
  await apply(() =>
    planMemoryMutation(f.context, {
      operation: 'delete',
      id: record.id,
      at: deletedAt,
      recordRevision: record.revision,
    }),
  );
  assert.equal((await syncNativeAutomatically(f.root, f.workspace)).conflicts, 1);
  assert.equal((await records(f)).length, 0);
});

test('credential-like data and malformed native metadata are skipped without retaining their content', async (t) => {
  const f = await fixture(t);
  const secret = 'sk-fixtureCredentialValueNeverPersist123456789';
  await fs.writeFile(path.join(f.native, 'credentials.md'), `# Credentials\n${secret}\n`);
  await fs.writeFile(path.join(f.native, 'broken.md'), '---\nname: [not valid\n---\nprivate body');
  await enable(f);
  const result = await syncNativeAutomatically(f.root, f.workspace);
  assert.equal(result.skipped, 2);
  assert.equal((await records(f)).length, 0);
  async function contents(directory) {
    const values = [];
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) values.push(...(await contents(file)));
      else if (entry.isFile()) values.push(await fs.readFile(file, 'utf8'));
    }
    return values;
  }
  assert.equal((await contents(f.root)).join('').includes(secret), false);
});

test('native symlinks are preserved, overlapping sources are rejected and stale source previews fail', async (t) => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.native, 'note.md'), '# Note\nOriginal fact.');
  await fs.symlink(path.join(f.native, 'note.md'), path.join(f.native, 'alias.md'));
  await assert.rejects(
    planAutomationSetup(f.root, f.workspace, 'claude-code', {
      hookFile: f.hooks('claude-code'),
      nativeDir: f.root,
    }),
    /must not overlap/,
  );
  await enable(f);
  const now = new Date().toISOString();
  const build = () => planNativeSync(f.root, f.workspace, now);
  const preview = await build();
  assert.equal(
    preview.rows.some((row) => row.action === 'skip'),
    true,
  );
  await fs.writeFile(path.join(f.native, 'note.md'), '# Note\nNew source fact.');
  await assert.rejects(applyManagedPlan(preview, build, preview.revision), /Inputs changed/);
  assert.equal((await records(f)).length, 0);
});

test('Stop hooks request one semantic checkpoint; DSH false loop flags cannot create an infinite continuation', async (t) => {
  const f = await fixture(t);
  await enable(f, 'dsh', null);
  await memoryHook(f.root, 'dsh', payload(f, 'SessionStart'));
  await memoryHook(
    f.root,
    'dsh',
    payload(f, 'UserPromptSubmit', { prompt: 'Fix the API client.' }),
  );
  const stop = await memoryHook(f.root, 'dsh', payload(f, 'Stop', { stop_hook_active: false }));
  assert.equal(stop.decision, 'block');
  const token = tokenOf(stop);
  assert.ok(token);
  assert.match(stop.reason, /already authorizes project autosave/);
  await memoryHook(f.root, 'dsh', payload(f, 'UserPromptSubmit', { prompt: stop.reason }));
  assert.equal(
    (await memoryHook(f.root, 'dsh', payload(f, 'Stop', { stop_hook_active: false }))).decision,
    undefined,
  );
  const saved = await automaticCheckpoint(f.root, f.workspace, 'dsh', token, {
    session: 'fixture-session',
    facts: [fact()],
  });
  assert.equal(saved.saved, 1);
  assert.equal((await records(f))[0].tags.includes('auto-extracted'), true);
  assert.equal((await autoStatus(f.root, f.workspace)).pendingCheckpoints, 0);
  await assert.rejects(
    automaticCheckpoint(f.root, f.workspace, 'dsh', token, {
      session: 'fixture-session',
      facts: [],
    }),
    /expired, was used/,
  );
  assert.equal(
    (await memoryHook(f.root, 'dsh', payload(f, 'Stop', { stop_hook_active: false }))).decision,
    undefined,
  );
  await memoryHook(f.root, 'dsh', payload(f, 'UserPromptSubmit', { prompt: 'A new real task.' }));
  assert.notEqual(tokenOf(await memoryHook(f.root, 'dsh', payload(f, 'Stop'))), token);
});

test('automatic checkpoints batch facts and index together and support an empty no-learning acknowledgement', async (t) => {
  const f = await fixture(t);
  await enable(f, 'codex', null);
  const stop = await memoryHook(f.root, 'codex', payload(f, 'Stop'));
  const result = await automaticCheckpoint(f.root, f.workspace, 'codex', tokenOf(stop), {
    session: 'fixture-session',
    facts: [fact(), fact('pagination', 'Follow the next cursor until absent.')],
  });
  assert.equal(result.saved, 2);
  assert.equal((await records(f)).length, 2);
  const index = await fs.readFile(
    (await memoryLocation(f.root, { workspace: f.workspace })).index,
    'utf8',
  );
  for (const record of await records(f)) assert.match(index, new RegExp(record.id));
  await apply(() => planManagedRestore(result.backup, f.root));
  assert.equal((await records(f)).length, 0);
  await assert.rejects(
    automaticCheckpoint(f.root, f.workspace, 'codex', tokenOf(stop), {
      session: 'fixture-session',
      facts: [],
    }),
    /expired, was used/,
  );
  await memoryHook(
    f.root,
    'codex',
    payload(f, 'UserPromptSubmit', { prompt: 'A fresh task after restore.' }),
  );
  const freshStop = await memoryHook(f.root, 'codex', payload(f, 'Stop'));
  const empty = await automaticCheckpoint(f.root, f.workspace, 'codex', tokenOf(freshStop), {
    session: 'fixture-session',
    facts: [],
  });
  assert.equal(empty.saved, 0);
  assert.equal(empty.changedPaths, 1);
});

test('checkpoint capabilities cannot cross projects, sessions or disabled clients', async (t) => {
  const f = await fixture(t);
  await enable(f, 'codex', null);
  const stop = await memoryHook(f.root, 'codex', payload(f, 'Stop'));
  const other = path.join(f.directory, 'other-project');
  await fs.mkdir(other);
  await exec('git', ['init', '-q', other]);
  await apply(() => planMemoryProject(f.root, 'other', other));
  await apply(() => planAutomationSetup(f.root, other, 'codex', { hookFile: f.hooks('codex') }));
  await assert.rejects(
    memoryHook(f.root, 'codex', { ...payload(f, 'Stop'), cwd: other }),
    /another memory project/,
  );
  await memoryHook(f.root, 'codex', {
    ...payload(f, 'Stop'),
    cwd: other,
    session_id: 'other-session',
  });
  await assert.rejects(
    automaticCheckpoint(f.root, other, 'codex', tokenOf(stop), {
      session: 'fixture-session',
      facts: [fact()],
    }),
    /does not match/,
  );
  await assert.rejects(
    automaticCheckpoint(f.root, f.workspace, 'claude-code', tokenOf(stop), {
      session: 'fixture-session',
      facts: [],
    }),
    /not enabled/,
  );
  await assert.rejects(
    automaticCheckpoint(f.root, f.workspace, 'codex', tokenOf(stop), {
      session: 'other-session',
      facts: [],
    }),
    /does not match/,
  );
  await apply(() => planAutomationDisable(f.root, f.workspace));
  assert.deepEqual(
    await memoryHook(f.root, 'codex', payload(f, 'UserPromptSubmit', { prompt: 'Next task' })),
    {},
  );
  await assert.rejects(
    automaticCheckpoint(f.root, f.workspace, 'codex', tokenOf(stop), {
      session: 'fixture-session',
      facts: [],
    }),
    /not enabled/,
  );
  const unknown = path.join(f.directory, 'unregistered');
  await fs.mkdir(unknown);
  await exec('git', ['init', '-q', unknown]);
  assert.deepEqual(await memoryHook(f.root, 'codex', { ...payload(f, 'Stop'), cwd: unknown }), {});
});

test('MCP exposes automatic capture only with its separate flag and saves through the same policy', async (t) => {
  const f = await fixture(t);
  await enable(f, 'codex', null);
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [cli, 'memory', 'serve', '--workspace', f.workspace, '--allow-auto'],
    env: { ...process.env, AGENT_HUB_HOME: f.root },
    stderr: 'pipe',
  });
  const connection = new Client({ name: 'auto-fixture', version: '1' });
  await connection.connect(transport);
  t.after(() => connection.close());
  assert.equal(
    (await connection.listTools()).tools.some((tool) => tool.name === 'memory_checkpoint'),
    true,
  );
  assert.equal(
    (await connection.listTools()).tools.some((tool) => tool.name === 'memory_apply'),
    false,
  );
  const stop = await memoryHook(f.root, 'codex', payload(f, 'Stop'));
  const result = await connection.callTool({
    name: 'memory_checkpoint',
    arguments: {
      client: 'codex',
      token: tokenOf(stop),
      session: 'fixture-session',
      facts: [fact()],
    },
  });
  assert.equal(result.isError, undefined);
  assert.equal(JSON.parse(result.content[0].text).saved, 1);
});

test('the foreground watcher imports changes and stops cleanly on SIGTERM', async (t) => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.native, 'note.md'), '# Watch note\nImported by the watcher.');
  await enable(f);
  const child = spawn(
    process.execPath,
    [cli, 'memory', 'auto', 'watch', '--workspace', f.workspace, '--interval', '5'],
    { env: { ...process.env, AGENT_HUB_HOME: f.root }, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  t.after(() => {
    if (child.exitCode === null) child.kill('SIGTERM');
  });
  await once(child.stdout, 'data', { signal: AbortSignal.timeout(10000) });
  const exited = once(child, 'exit');
  child.kill('SIGTERM');
  const [code] = await exited;
  assert.equal(code, 0);
  assert.equal((await records(f)).length, 1);
});

test('CLI hooks accept JSON stdin without copying conversation text into memory', async (t) => {
  const f = await fixture(t);
  await enable(f, 'codex', null);
  const input = payload(f, 'UserPromptSubmit', {
    prompt: 'Sensitive transient discussion that is not itself a fact.',
  });
  const child = spawn(process.execPath, [cli, 'memory', 'auto', 'hook', '--client', 'codex'], {
    env: { ...process.env, AGENT_HUB_HOME: f.root },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk) => {
    output += chunk;
  });
  child.stdin.end(JSON.stringify(input));
  const [code] = await once(child, 'exit');
  assert.equal(code, 0);
  assert.deepEqual(JSON.parse(output), {});
  assert.equal((await records(f)).length, 0);
  const state = await fs.readFile(
    path.join(
      (await memoryLocation(f.root, { workspace: f.workspace })).directory,
      'automation',
      'sessions',
      hash('codex:fixture-session') + '.json',
    ),
    'utf8',
  );
  assert.equal(state.includes(input.prompt), false);
});

test('a conversation with an older memory baseline cannot overwrite another agent learning', async (t) => {
  const f = await fixture(t);
  await enable(f, 'codex', null);
  const first = await memoryHook(f.root, 'codex', payload(f, 'Stop'));
  await automaticCheckpoint(f.root, f.workspace, 'codex', tokenOf(first), {
    session: 'fixture-session',
    facts: [fact()],
  });
  await memoryHook(
    f.root,
    'codex',
    payload(f, 'UserPromptSubmit', { prompt: 'Long running task A.' }),
  );
  const b = (event, extra = {}) => payload(f, event, { session_id: 'agent-b', ...extra });
  await memoryHook(
    f.root,
    'codex',
    b('UserPromptSubmit', { prompt: 'Task B learns an updated API rule.' }),
  );
  const newer = await memoryHook(f.root, 'codex', b('Stop'));
  await automaticCheckpoint(f.root, f.workspace, 'codex', tokenOf(newer), {
    session: 'agent-b',
    facts: [fact('retry-rule', 'The current verified rule from agent B.')],
  });
  const stale = await memoryHook(f.root, 'codex', payload(f, 'Stop'));
  const result = await automaticCheckpoint(f.root, f.workspace, 'codex', tokenOf(stale), {
    session: 'fixture-session',
    facts: [fact('retry-rule', 'A stale alternative from agent A.')],
  });
  assert.equal(result.saved, 0);
  assert.equal(result.conflicts, 1);
  assert.equal(
    (await getMemory(f.context, (await records(f))[0].id)).body,
    'The current verified rule from agent B.',
  );
});

test('expired checkpoint tokens fail and session startup prunes expired capability metadata only', async (t) => {
  const f = await fixture(t);
  await enable(f, 'codex', null);
  const stop = await memoryHook(f.root, 'codex', payload(f, 'Stop'));
  const location = await memoryLocation(f.root, { workspace: f.workspace });
  const statePath = path.join(
    location.directory,
    'automation',
    'sessions',
    hash('codex:fixture-session') + '.json',
  );
  const state = JSON.parse(await fs.readFile(statePath, 'utf8'));
  state.expires = Date.now() - 1;
  await fs.writeFile(statePath, JSON.stringify(state));
  await assert.rejects(
    automaticCheckpoint(f.root, f.workspace, 'codex', tokenOf(stop), {
      session: 'fixture-session',
      facts: [fact()],
    }),
    /expired/,
  );
  await memoryHook(f.root, 'codex', payload(f, 'SessionStart', { session_id: 'fresh-session' }));
  await assert.rejects(fs.access(statePath));
  assert.equal((await records(f)).length, 0);
});

test('CLI setup replays an exact plan, imports native knowledge and reports the enabled policy', async (t) => {
  const f = await fixture(t);
  await fs.writeFile(
    path.join(f.native, 'rule.md'),
    '# Native rule\nA durable native project rule.',
  );
  const env = {
    ...process.env,
    AGENT_HUB_HOME: f.root,
    CLAUDE_CONFIG_DIR: path.join(f.directory, 'claude'),
    CODEX_HOME: path.join(f.directory, 'codex'),
    DSH_HOME: path.join(f.directory, 'dsh'),
  };
  const args = [
    cli,
    'memory',
    'auto',
    'enable',
    '--workspace',
    f.workspace,
    '--client',
    'claude-code',
    '--native-dir',
    f.native,
    '--json',
  ];
  const preview = JSON.parse((await exec(process.execPath, args, { env })).stdout);
  assert.equal(preview.dryRun, true);
  assert.equal((await records(f)).length, 0);
  const applied = JSON.parse(
    (await exec(process.execPath, [...args, '--apply', '--expect', preview.revision], { env }))
      .stdout,
  );
  assert.equal(applied.dryRun, false);
  assert.equal((await records(f)).length, 1);
  const status = JSON.parse(
    (
      await exec(
        process.execPath,
        [cli, 'memory', 'auto', 'status', '--workspace', f.workspace, '--json'],
        { env },
      )
    ).stdout,
  );
  assert.equal(status.policy.enabled, true);
  assert.equal(status.policy.native.length, 1);
  assert.equal((await fs.stat(path.join(env.CLAUDE_CONFIG_DIR, 'settings.json'))).isFile(), true);
});

test('independent automatic MCP writers retry brief contention and retain both new facts', async (t) => {
  const f = await fixture(t);
  await enable(f, 'codex', null);
  const connections = [];
  for (let index = 0; index < 2; index++) {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [cli, 'memory', 'serve', '--workspace', f.workspace, '--allow-auto'],
      env: { ...process.env, AGENT_HUB_HOME: f.root },
      stderr: 'pipe',
    });
    const connection = new Client({ name: `auto-writer-${index}`, version: '1' });
    await connection.connect(transport);
    connections.push(connection);
    t.after(() => connection.close());
  }
  const stops = [];
  for (let index = 0; index < 2; index++)
    stops.push(
      await memoryHook(f.root, 'codex', payload(f, 'Stop', { session_id: `writer-${index}` })),
    );
  const results = await Promise.all(
    connections.map((connection, index) =>
      connection.callTool({
        name: 'memory_checkpoint',
        arguments: {
          client: 'codex',
          token: tokenOf(stops[index]),
          session: `writer-${index}`,
          facts: [fact(`writer-${index}`, `Independent knowledge from writer ${index}.`)],
        },
      }),
    ),
  );
  assert.equal(
    results.some((result) => result.isError),
    false,
  );
  assert.equal((await records(f)).length, 2);
  assert.equal((await autoStatus(f.root, f.workspace)).pendingCheckpoints, 0);
});
