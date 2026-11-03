import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { stringify as yaml } from 'yaml';
import { stringify as toml } from 'smol-toml';
import { inspectArtifact } from '../dist/core/artifacts.js';

const cli = path.resolve('dist/cli.js');
const secret = 'quick-fixture-private-token';
async function fixture(t) {
  const base = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'ahub-quick-')));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const root = path.join(base, 'hub');
  const workspace = path.join(base, 'project');
  const claude = path.join(base, 'claude');
  const codex = path.join(base, 'codex');
  const dsh = path.join(base, 'dsh');
  const shared = path.join(base, 'shared-skills');
  for (const dir of [workspace, claude, codex, path.join(dsh, 'profiles/web'), shared])
    await fs.mkdir(dir, { recursive: true });
  execFileSync('git', ['init', '-q', workspace]);
  const server = { command: 'fixture-mcp', args: ['serve'], env: { API_TOKEN: secret } };
  const configs = [
    path.join(base, 'claude.json'),
    path.join(codex, 'config.toml'),
    path.join(dsh, 'profiles/web/cordis.patch.yml'),
  ];
  await fs.writeFile(
    configs[0],
    JSON.stringify({ preferences: { keep: true }, mcpServers: { demo: server } }),
  );
  await fs.writeFile(configs[1], toml({ model: 'fixture', mcp_servers: { demo: server } }));
  await fs.writeFile(
    configs[2],
    yaml([
      {
        insert: [
          {
            id: 'demo',
            name: '@deepseek-ai/dsh-mcp-client',
            config: { serverName: 'demo', transport: 'stdio', ...server },
          },
        ],
      },
    ]),
  );
  const skill = path.join(claude, 'skills', 'demo-skill');
  await fs.mkdir(skill, { recursive: true });
  await fs.writeFile(
    path.join(skill, 'SKILL.md'),
    '---\nname: demo-skill\ndescription: A fixture skill\n---\nUse the fixture.\n',
  );
  await fs.writeFile(path.join(skill, 'asset.txt'), 'preserve the complete bundle');
  const notes = path.join(workspace, '.claude/memory');
  await fs.mkdir(notes, { recursive: true });
  await fs.writeFile(path.join(notes, 'rule.md'), '# API rule\nUse idempotency keys.\n');
  await fs.writeFile(path.join(workspace, 'AGENTS.md'), '# Existing rules\nPreserve this text.\n');
  const env = {
    ...process.env,
    AGENT_HUB_HOME: root,
    AGENT_HUB_CLAUDE_CONFIG: configs[0],
    CLAUDE_CONFIG_DIR: claude,
    CODEX_HOME: codex,
    DSH_HOME: dsh,
    AGENT_HUB_SHARED_SKILLS: shared,
  };
  const originals = await Promise.all(
    [...configs, skill, shared, path.join(workspace, 'AGENTS.md')].map(inspectArtifact),
  );
  function run(args, expected = 0) {
    const result = spawnSync(process.execPath, [cli, ...args, '--json'], {
      cwd: workspace,
      env,
      encoding: 'utf8',
    });
    assert.equal(result.status, expected, result.stderr || result.stdout);
    assert.equal(result.stdout.includes(secret), false);
    return JSON.parse(result.stdout);
  }
  const preview = (args = []) => run(['quick', ...args]);
  const apply = (plan, args = [], code = 0) =>
    run(['quick', '--apply', '--expect', plan.revision, '--at', plan.at, ...args], code);
  return {
    base,
    root,
    workspace,
    claude,
    codex,
    dsh,
    shared,
    configs,
    notes,
    env,
    originals,
    run,
    preview,
    apply,
  };
}

test('quick previews without writes, creates a working Hub across three clients, repeats without writes, and resets originals', async (t) => {
  const f = await fixture(t);
  const before = await inspectArtifact(f.base);
  const plan = f.preview();
  assert.equal(plan.blocked, false);
  assert.equal(
    plan.steps.find((step) => step.id === 'memory').note.startsWith('1 project-matched'),
    true,
  );
  assert.equal((await inspectArtifact(f.base)).fingerprint, before.fingerprint);
  const result = f.apply(plan);
  assert.equal(result.status, 'complete', JSON.stringify(result.steps, null, 2));
  for (const id of ['claude-code', 'codex', 'dsh']) {
    assert.equal(result.steps.find((step) => step.id === `mcp:${id}`).status, 'done');
    assert.equal(result.steps.find((step) => step.id === `automation:${id}`).status, 'done');
  }
  assert.equal(
    await fs.readFile(path.join(f.root, 'skills/demo-skill/asset.txt'), 'utf8'),
    'preserve the complete bundle',
  );
  assert.equal((await fs.lstat(path.join(f.shared, 'demo-skill'))).isSymbolicLink(), true);
  const records = f.run(['memory', 'ls']);
  assert.match(JSON.stringify(records), /API rule/);
  assert.match(
    await fs.readFile(path.join(f.workspace, 'AGENTS.md'), 'utf8'),
    /Preserve this text/,
  );
  const repeated = f.apply(f.preview());
  assert.equal(repeated.status, 'complete', JSON.stringify(repeated.steps, null, 2));
  assert.equal(
    repeated.steps.some((step) => step.changed > 0),
    false,
    JSON.stringify(repeated.steps, null, 2),
  );
  const recovery = f.run(['reset']);
  f.run(['reset', '--apply', '--expect', recovery.revision]);
  await assert.rejects(fs.access(f.root), { code: 'ENOENT' });
  for (const original of f.originals)
    assert.equal(
      (await inspectArtifact(original.path)).fingerprint,
      original.fingerprint,
      original.path,
    );
});

test('quick refuses a stale preview before creating Hub or touching clients', async (t) => {
  const f = await fixture(t);
  const plan = f.preview();
  await fs.appendFile(path.join(f.notes, 'rule.md'), '\nAn external edit.\n');
  const result = spawnSync(
    process.execPath,
    [cli, 'quick', '--apply', '--at', plan.at, '--expect', plan.revision],
    { env: f.env, cwd: f.workspace, encoding: 'utf8' },
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /current quick preview|changed since preview/);
  await assert.rejects(fs.access(f.root), { code: 'ENOENT' });
});

test('quick preserves ambiguous MCP definitions and finishes independent areas with a review result', async (t) => {
  const f = await fixture(t);
  const original = toml({ mcp_servers: { demo: { command: 'different-local-server' } } });
  await fs.writeFile(f.configs[1], original);
  const plan = f.preview(['--no-automation']);
  assert.equal(
    plan.steps
      .find((step) => step.id === 'mcpImport')
      .rows.some((row) => row.action === 'conflict'),
    true,
  );
  const result = f.apply(plan, ['--no-automation'], 1);
  assert.equal(result.status, 'needs-review');
  assert.equal(await fs.readFile(f.configs[1], 'utf8'), original);
  assert.equal(result.steps.find((step) => step.id === 'memory').status, 'done');
  assert.equal(
    result.steps.some((step) => step.id.startsWith('automation:')),
    false,
  );
  assert.equal((await fs.lstat(path.join(f.shared, 'demo-skill'))).isSymbolicLink(), true);
});

test('quick validates client scope and supports global setup outside a Git workspace', async (t) => {
  const f = await fixture(t);
  const bad = spawnSync(process.execPath, [cli, 'quick', '--client', 'unknown'], {
    env: f.env,
    cwd: f.base,
    encoding: 'utf8',
  });
  assert.equal(bad.status, 1);
  await assert.rejects(fs.access(f.root), { code: 'ENOENT' });
  const plan = f.preview(['--client', 'claude-code', '--no-project']);
  const result = f.apply(plan, ['--client', 'claude-code', '--no-project']);
  assert.equal(result.workspace, null);
  assert.equal(result.status, 'complete');
  assert.equal(
    result.steps.some((step) => step.id.startsWith('automation:')),
    false,
  );
  assert.equal((await inspectArtifact(f.configs[1])).fingerprint, f.originals[1].fingerprint);
});

test('quick reset also works when a DSH profile was first managed by the artifact engine', async (t) => {
  const f = await fixture(t);
  await fs.mkdir(f.root);
  await fs.writeFile(path.join(f.root, 'hub.yaml'), 'version: 1\n');
  const registration = ['memory', 'project', 'register', 'trial', f.workspace];
  const registered = f.run(registration);
  f.run([...registration, '--apply', '--expect', registered.revision]);
  const hooks = ['memory', 'auto', 'enable', '--client', 'dsh'];
  const hookPlan = f.run(hooks);
  f.run([...hooks, '--apply', '--expect', hookPlan.revision]);
  const result = f.apply(f.preview());
  assert.equal(result.status, 'complete');
  const recovery = f.run(['reset']);
  assert.equal(recovery.blocked, false);
  f.run(['reset', '--apply', '--expect', recovery.revision]);
  assert.equal((await inspectArtifact(f.configs[2])).fingerprint, f.originals[2].fingerprint);
});

test('content restore recognizes a file first captured by MCP recovery and still protects external edits', async (t) => {
  const f = await fixture(t);
  f.apply(f.preview(['--no-automation']), ['--no-automation']);
  const before = await fs.readFile(f.configs[2], 'utf8');
  const args = ['memory', 'auto', 'enable', '--client', 'dsh'];
  const plan = f.run(args);
  const installed = f.run([...args, '--apply', '--expect', plan.revision]);
  const restoreArgs = ['restore', installed.result.backup];
  const restore = f.run(restoreArgs);
  assert.equal(restore.blocked, false);
  f.run([...restoreArgs, '--apply', '--expect', restore.revision]);
  assert.equal(await fs.readFile(f.configs[2], 'utf8'), before);
  await fs.appendFile(f.configs[2], '\n# independent edit\n');
  const recovery = f.run(['reset'], 1);
  assert.equal(recovery.blocked, true);
});

test('a failed hook stage leaves its source intact while independent delivery completes', async (t) => {
  const f = await fixture(t);
  const hook = path.join(f.claude, 'settings.json');
  await fs.writeFile(hook, 'invalid JSON: keep this original');
  const result = f.apply(f.preview(), [], 1);
  assert.equal(result.status, 'needs-review');
  assert.equal(result.steps.find((step) => step.id === 'automation:claude-code').status, 'failed');
  assert.equal(result.steps.find((step) => step.id === 'mcp:claude-code').status, 'done');
  assert.equal(result.steps.find((step) => step.id === 'automation:codex').status, 'done');
  assert.equal(await fs.readFile(hook, 'utf8'), 'invalid JSON: keep this original');
  const reset = f.run(['reset']);
  f.run(['reset', '--apply', '--expect', reset.revision]);
  assert.equal(await fs.readFile(hook, 'utf8'), 'invalid JSON: keep this original');
});

test('quick retains protection for a disabled client sharing a selected client skill root', async (t) => {
  const f = await fixture(t);
  await fs.mkdir(path.join(f.root, 'skills'), { recursive: true });
  await fs.writeFile(
    path.join(f.root, 'hub.yaml'),
    'version: 1\nclients:\n  dsh:\n    enabled: false\n',
  );
  await fs.cp(path.join(f.claude, 'skills/demo-skill'), path.join(f.root, 'skills/demo-skill'), {
    recursive: true,
  });
  const args = ['--client', 'codex', '--no-project'];
  const result = f.apply(f.preview(args), args, 1);
  assert.equal(result.status, 'needs-review');
  assert.equal(result.steps.find((step) => step.id === 'skills:codex').status, 'review');
  await assert.rejects(fs.access(path.join(f.shared, 'demo-skill')), { code: 'ENOENT' });
  assert.equal((await inspectArtifact(f.configs[2])).fingerprint, f.originals[2].fingerprint);
});
