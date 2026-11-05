import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { execFileSync } from 'node:child_process';
import { planMemoryProject } from '../dist/core/projects/memory-bindings.js';
import { planProjectDisconnect } from '../dist/core/projects/disconnect.js';
import { applyManagedPlan } from '../dist/core/recovery/managed-plan.js';
import { ingestHistory } from '../dist/core/history/ingest.js';
import { planHistoryConnection, applyHistoryConnection } from '../dist/core/history/connection.js';
import { listHistory } from '../dist/core/history/query.js';
import { readHistory } from '../dist/core/history/storage.js';
import { historyFixture } from './helpers/history.mjs';

async function connectionFixture(t) {
  const f = await historyFixture(t);
  await ingestHistory(f.root, [f.source]);
  await fs.mkdir(path.join(f.root, 'mcp'), { recursive: true });
  await fs.writeFile(path.join(f.root, 'hub.yaml'), 'version: 1\n');
  await fs.writeFile(path.join(f.root, 'mcp', 'servers.yaml'), 'version: 1\nservers: {}\n');
  const originals = [
    '{"theme":"keep","mcpServers":{}}\n',
    'theme = "keep"\n',
    '- name: ui-preferences\n  config:\n    theme: keep\n',
  ];
  const targets = ['claude-code', 'codex', 'dsh'].map((id, index) => ({
    id,
    label: id,
    file: path.join(f.temporary, `client-${index}.config`),
    installed: true,
  }));
  for (const [index, target] of targets.entries())
    await fs.writeFile(target.file, originals[index]);
  const context = {
    root: f.root,
    node: process.execPath,
    cli: path.resolve('dist/cli.js'),
    targets,
  };
  return { ...f, originals, context, projectId: (await readHistory(f.root)).projects[0].id };
}

test('one reviewed project-history connection delivers its scoped MCP to all clients, preserving unrelated settings', async (t) => {
  const f = await connectionFixture(t);
  const plan = await planHistoryConnection(f.root, f.projectId, undefined, f.context);
  assert.equal(plan.publicPlan.blocked, false);
  assert.equal(plan.publicPlan.deliveries.length, 3);
  for (const [index, target] of f.context.targets.entries())
    assert.equal(await fs.readFile(target.file, 'utf8'), f.originals[index]);
  assert.deepEqual((await readHistory(f.root)).grants, []);
  const applied = await applyHistoryConnection(plan, plan.publicPlan.revision);
  assert.equal(applied.status, 'complete');
  assert.equal(applied.steps.length, 3);
  for (const target of f.context.targets) {
    const text = await fs.readFile(target.file, 'utf8');
    assert.match(text, /keep/);
    assert.ok(text.includes(plan.publicPlan.grant));
  }
  assert.equal((await listHistory(f.root, { grant: plan.publicPlan.grant })).total, 1);
  const native = JSON.parse(await fs.readFile(f.context.targets[0].file, 'utf8')).mcpServers[
    plan.publicPlan.grant
  ];
  const transport = new StdioClientTransport({
    command: native.command,
    args: native.args,
    env: { ...process.env, ...native.env },
    stderr: 'pipe',
  });
  const client = new Client({ name: 'native-history-fixture', version: '1' });
  t.after(async () => {
    await client.close();
    await transport.close();
  });
  await client.connect(transport);
  const search = await client.callTool({
    name: 'history_search',
    arguments: { query: 'End sentinel' },
  });
  assert.equal(JSON.parse(search.content[0].text).total, 1);
  assert.ok(applied.undoCommand);
  const again = await planHistoryConnection(f.root, f.projectId, undefined, f.context);
  const repeated = await applyHistoryConnection(again, again.publicPlan.revision);
  assert.equal(repeated.status, 'complete');
  assert.ok(repeated.steps.every((step) => step.changedFiles === 0));
});

test('changed native settings invalidate a reviewed history connection before any grant or client mutation', async (t) => {
  const f = await connectionFixture(t);
  const plan = await planHistoryConnection(f.root, f.projectId, ['claude-code'], f.context);
  await fs.appendFile(f.context.targets[1].file, '# external edit\n');
  // Only the selected client is affected by this plan; its own change must block apply.
  await fs.writeFile(f.context.targets[0].file, '{"theme":"new","mcpServers":{}}\n');
  await assert.rejects(applyHistoryConnection(plan, plan.publicPlan.revision), /changed|blocked/);
  assert.deepEqual((await readHistory(f.root)).grants, []);
  assert.equal(
    await fs.readFile(path.join(f.root, 'mcp', 'servers.yaml'), 'utf8'),
    'version: 1\nservers: {}\n',
  );
  assert.equal(await fs.readFile(f.context.targets[2].file, 'utf8'), f.originals[2]);
});

test('disconnecting a registered memory project also revokes its associated archive connection without deleting chats', async (t) => {
  const f = await connectionFixture(t);
  execFileSync('git', ['init', '-q', '--template=', '-b', 'master'], {
    cwd: f.project,
    env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' },
  });
  const binding = await planMemoryProject(f.root, 'registered-project', f.project);
  await applyManagedPlan(
    binding,
    () => planMemoryProject(f.root, 'registered-project', f.project),
    binding.revision,
  );
  const connection = await planHistoryConnection(f.root, f.projectId, ['claude-code'], f.context);
  await applyHistoryConnection(connection, connection.publicPlan.revision);
  assert.equal((await listHistory(f.root, { grant: connection.publicPlan.grant })).total, 1);
  const plan = await planProjectDisconnect(f.root, 'registered-project');
  await applyManagedPlan(
    plan,
    () => planProjectDisconnect(f.root, 'registered-project'),
    plan.revision,
  );
  await assert.rejects(listHistory(f.root, { grant: connection.publicPlan.grant }), /revoked/);
  assert.equal((await readHistory(f.root)).chats.length, 1);
});
