import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { stringify as yaml } from 'yaml';
import { stringify as toml } from 'smol-toml';
import { readDefinitions } from '../dist/core/config-edit.js';
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
  function run(args, expected = 0, cwd = workspace) {
    const result = spawnSync(process.execPath, [cli, ...args, '--json'], {
      cwd,
      env,
      encoding: 'utf8',
    });
    assert.equal(result.status, expected, result.stderr || result.stdout);
    assert.equal(result.stdout.includes(secret), false);
    return JSON.parse(result.stdout);
  }
  const preview = (args = []) => run(['quick', ...args]);
  const connect = (args = []) => run(['project', 'connect', workspace, ...args]);
  const apply = (plan, args = [], code = 0) =>
    run(
      [
        ...(plan.scope === 'project' ? ['project', 'connect', workspace] : ['quick']),
        '--apply',
        '--expect',
        plan.revision,
        '--at',
        plan.at,
        ...args,
      ],
      code,
    );
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
    connect,
    apply,
  };
}

test('shared Hub setup and optional project connection are separate, read-only previews with idempotent apply and full recovery', async (t) => {
  const f = await fixture(t);
  const before = await inspectArtifact(f.base);
  const plan = f.preview();
  assert.equal(plan.scope, 'hub');
  assert.equal(plan.workspace, null);
  assert.equal(
    plan.steps.some((step) => ['project', 'repo', 'memory', 'automation'].includes(step.id)),
    false,
  );
  assert.equal(plan.commands.apply.includes('--workspace'), false);
  assert.equal((await inspectArtifact(f.base)).fingerprint, before.fingerprint);
  const result = f.apply(plan);
  assert.equal(result.status, 'complete', JSON.stringify(result.steps, null, 2));
  for (const id of ['claude-code', 'codex', 'dsh'])
    assert.equal(result.steps.find((step) => step.id === `mcp:${id}`).status, 'done');
  assert.equal(
    (await inspectArtifact(path.join(f.workspace, 'AGENTS.md'))).fingerprint,
    f.originals.at(-1).fingerprint,
  );
  await assert.rejects(fs.access(path.join(f.root, 'memory/projects.json')), { code: 'ENOENT' });
  await assert.rejects(fs.access(path.join(f.claude, 'settings.json')), { code: 'ENOENT' });
  const beforeConnect = await inspectArtifact(f.base);
  const project = f.connect();
  assert.equal(project.scope, 'project');
  assert.equal(project.workspace, f.workspace);
  assert.match(project.steps.find((step) => step.id === 'memory').note, /^1 project-matched/);
  assert.equal((await inspectArtifact(f.base)).fingerprint, beforeConnect.fingerprint);
  const connected = f.apply(project);
  assert.equal(connected.status, 'complete', JSON.stringify(connected.steps, null, 2));
  assert.equal(
    connected.steps.some((step) => /^(mcp|skills|context):/.test(step.id)),
    false,
  );
  for (const id of ['claude-code', 'codex', 'dsh'])
    assert.equal(connected.steps.find((step) => step.id === `automation:${id}`).status, 'done');
  assert.match(JSON.stringify(f.run(['memory', 'ls'])), /API rule/);
  assert.equal(
    await fs.readFile(path.join(f.root, 'skills/demo-skill/asset.txt'), 'utf8'),
    'preserve the complete bundle',
  );
  assert.equal((await fs.lstat(path.join(f.shared, 'demo-skill'))).isSymbolicLink(), true);
  for (const next of [f.preview(), f.connect()]) {
    const repeated = f.apply(next);
    assert.equal(repeated.status, 'complete', JSON.stringify(repeated.steps, null, 2));
    assert.equal(
      repeated.steps.some((step) => step.changed > 0),
      false,
      JSON.stringify(repeated.steps, null, 2),
    );
  }
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

test('shared Hub preview ignores cwd, project note edits and Git project identity', async (t) => {
  const f = await fixture(t);
  const plan = f.preview();
  await fs.appendFile(path.join(f.notes, 'rule.md'), '\nA project note edit.\n');
  await fs.appendFile(path.join(f.workspace, 'AGENTS.md'), '\nA repository instruction edit.\n');
  const outside = f.run(['quick', '--at', plan.at], 0, f.base);
  assert.equal(outside.revision, plan.revision);
  const result = f.apply(plan);
  assert.equal(result.status, 'complete');
  assert.match(
    await fs.readFile(path.join(f.workspace, 'AGENTS.md'), 'utf8'),
    /repository instruction edit/,
  );
});

test('quick refuses stale global configuration before creating Hub', async (t) => {
  const f = await fixture(t);
  const plan = f.preview();
  await fs.appendFile(f.configs[1], '\n# external config edit\n');
  const result = spawnSync(
    process.execPath,
    [cli, 'quick', '--apply', '--at', plan.at, '--expect', plan.revision],
    { env: f.env, cwd: f.workspace, encoding: 'utf8' },
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /current quick preview|changed since preview/);
  await assert.rejects(fs.access(f.root), { code: 'ENOENT' });
});

test('project connection validates its prerequisite and Git directory, and rejects stale native memory', async (t) => {
  const f = await fixture(t);
  const missing = spawnSync(process.execPath, [cli, 'project', 'connect', f.workspace], {
    env: f.env,
    encoding: 'utf8',
  });
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /ahub quick/);
  await assert.rejects(fs.access(f.root), { code: 'ENOENT' });
  const legacy = spawnSync(process.execPath, [cli, 'quick', '--workspace', f.workspace], {
    env: f.env,
    encoding: 'utf8',
  });
  assert.equal(legacy.status, 1);
  assert.match(legacy.stderr, /ahub project connect/);
  f.apply(f.preview());
  const invalid = spawnSync(process.execPath, [cli, 'project', 'connect', f.base], {
    env: f.env,
    encoding: 'utf8',
  });
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /Git repository/);
  const plan = f.connect();
  await fs.appendFile(path.join(f.notes, 'rule.md'), '\nChanged after connection preview.\n');
  const stale = spawnSync(
    process.execPath,
    [cli, 'project', 'connect', f.workspace, '--apply', '--at', plan.at, '--expect', plan.revision],
    { env: f.env, encoding: 'utf8' },
  );
  assert.equal(stale.status, 1);
  await assert.rejects(fs.access(path.join(f.root, 'memory/projects.json')), { code: 'ENOENT' });
});

test('project connection does not import or deliver pending global MCP, skill or instruction changes', async (t) => {
  const f = await fixture(t);
  f.apply(f.preview());
  await fs.mkdir(path.join(f.root, 'instructions'), { recursive: true });
  await fs.writeFile(
    path.join(f.root, 'instructions/AGENTS.md'),
    '# Pending global rule\nDeliver this separately.\n',
  );
  const configBefore = await Promise.all(
    f.configs.map(async (file, i) => [
      ...readDefinitions(['claude-code', 'codex', 'dsh'][i], await fs.readFile(file, 'utf8')),
    ]),
  );
  const sharedBefore = await inspectArtifact(f.shared);
  const instructions = await Promise.all(
    [
      path.join(f.claude, 'CLAUDE.md'),
      path.join(f.codex, 'AGENTS.md'),
      path.join(f.dsh, 'AGENTS.md'),
    ].map(inspectArtifact),
  );
  f.apply(f.connect());
  for (const [i, file] of f.configs.entries())
    assert.deepEqual(
      [...readDefinitions(['claude-code', 'codex', 'dsh'][i], await fs.readFile(file, 'utf8'))],
      configBefore[i],
    );
  assert.equal((await inspectArtifact(f.shared)).fingerprint, sharedBefore.fingerprint);
  for (const file of instructions)
    assert.equal((await inspectArtifact(file.path)).fingerprint, file.fingerprint);
});

test('ambiguous global definitions stay unchanged while an independently connected project can import memory', async (t) => {
  const f = await fixture(t);
  const original = toml({ mcp_servers: { demo: { command: 'different-local-server' } } });
  await fs.writeFile(f.configs[1], original);
  const plan = f.preview();
  assert.equal(
    plan.steps
      .find((step) => step.id === 'mcpImport')
      .rows.some((row) => row.action === 'conflict'),
    true,
  );
  const result = f.apply(plan, [], 1);
  assert.equal(result.status, 'needs-review');
  assert.equal(await fs.readFile(f.configs[1], 'utf8'), original);
  const connected = f.apply(f.connect(['--no-automation']), ['--no-automation']);
  assert.equal(connected.steps.find((step) => step.id === 'memory').status, 'done');
  assert.equal(
    connected.steps.some((step) => step.id.startsWith('automation:')),
    false,
  );
  assert.equal(await fs.readFile(f.configs[1], 'utf8'), original);
});

test('quick validates client scope and keeps a hidden legacy --no-project option harmless', async (t) => {
  const f = await fixture(t);
  const bad = spawnSync(process.execPath, [cli, 'quick', '--client', 'unknown'], {
    env: f.env,
    cwd: f.base,
    encoding: 'utf8',
  });
  assert.equal(bad.status, 1);
  await assert.rejects(fs.access(f.root), { code: 'ENOENT' });
  const args = ['--client', 'claude-code', '--no-project'];
  const result = f.apply(f.preview(args), args);
  assert.equal(result.workspace, null);
  assert.equal(result.status, 'complete');
  assert.equal((await inspectArtifact(f.configs[1])).fingerprint, f.originals[1].fingerprint);
  const help = spawnSync(process.execPath, [cli, 'quick', '--help'], {
    env: f.env,
    encoding: 'utf8',
  });
  assert.doesNotMatch(help.stdout, /--workspace|--no-project|--no-automation/);
});

test('quick reset works when the artifact engine first managed a DSH profile', async (t) => {
  const f = await fixture(t);
  await fs.mkdir(f.root);
  await fs.writeFile(path.join(f.root, 'hub.yaml'), 'version: 1\n');
  const registration = ['memory', 'project', 'register', 'trial', f.workspace];
  const registered = f.run(registration);
  f.run([...registration, '--apply', '--expect', registered.revision]);
  const hooks = ['memory', 'auto', 'enable', '--client', 'dsh'];
  const hookPlan = f.run(hooks);
  f.run([...hooks, '--apply', '--expect', hookPlan.revision]);
  assert.equal(f.apply(f.preview()).status, 'complete');
  const recovery = f.run(['reset']);
  f.run(['reset', '--apply', '--expect', recovery.revision]);
  assert.equal((await inspectArtifact(f.configs[2])).fingerprint, f.originals[2].fingerprint);
});

test('content restore recognizes a file first captured by MCP recovery and protects external edits', async (t) => {
  const f = await fixture(t);
  f.apply(f.preview());
  f.apply(f.connect(['--no-automation']), ['--no-automation']);
  const before = await fs.readFile(f.configs[2], 'utf8');
  const args = ['memory', 'auto', 'enable', '--client', 'dsh'];
  const plan = f.run(args);
  const installed = f.run([...args, '--apply', '--expect', plan.revision]);
  const restoreArgs = ['restore', installed.result.backup];
  const restore = f.run(restoreArgs);
  f.run([...restoreArgs, '--apply', '--expect', restore.revision]);
  assert.equal(await fs.readFile(f.configs[2], 'utf8'), before);
  await fs.appendFile(f.configs[2], '\n# independent edit\n');
  assert.equal(f.run(['reset'], 1).blocked, true);
});

test('failed project hooks leave their source intact while other project clients connect', async (t) => {
  const f = await fixture(t);
  f.apply(f.preview());
  const hook = path.join(f.claude, 'settings.json');
  await fs.writeFile(hook, 'invalid JSON: keep this original');
  const result = f.apply(f.connect(), [], 1);
  assert.equal(result.status, 'needs-review');
  assert.equal(result.steps.find((step) => step.id === 'automation:claude-code').status, 'failed');
  assert.equal(result.steps.find((step) => step.id === 'automation:codex').status, 'done');
  assert.equal(
    result.steps.some((step) => step.id.startsWith('mcp:')),
    false,
  );
  assert.equal(await fs.readFile(hook, 'utf8'), 'invalid JSON: keep this original');
  const reset = f.run(['reset']);
  f.run(['reset', '--apply', '--expect', reset.revision]);
  assert.equal(await fs.readFile(hook, 'utf8'), 'invalid JSON: keep this original');
});

test('quick protects a disabled client sharing a selected client skill root', async (t) => {
  const f = await fixture(t);
  await fs.mkdir(path.join(f.root, 'skills'), { recursive: true });
  await fs.writeFile(
    path.join(f.root, 'hub.yaml'),
    'version: 1\nclients:\n  dsh:\n    enabled: false\n',
  );
  await fs.cp(path.join(f.claude, 'skills/demo-skill'), path.join(f.root, 'skills/demo-skill'), {
    recursive: true,
  });
  const args = ['--client', 'codex'];
  const result = f.apply(f.preview(args), args, 1);
  assert.equal(result.status, 'needs-review');
  assert.equal(result.steps.find((step) => step.id === 'skills:codex').status, 'review');
  await assert.rejects(fs.access(path.join(f.shared, 'demo-skill')), { code: 'ENOENT' });
  assert.equal((await inspectArtifact(f.configs[2])).fingerprint, f.originals[2].fingerprint);
});
