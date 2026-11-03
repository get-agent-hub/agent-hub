import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { stringify as yaml } from 'yaml';
import { stringify as toml } from 'smol-toml';
import { planSync, applySync } from '../dist/core/sync.js';
import { planReset, applyReset, publicResetPlan } from '../dist/core/reset.js';
import { readBaseline, baselineDirectory } from '../dist/core/baseline.js';
import { inspectTree } from '../dist/core/recovery-tree.js';
import { recoveryRoot } from '../dist/core/recovery-paths.js';
import { withHubLock } from '../dist/core/hub-lock.js';
import { planRestore, applyRestore } from '../dist/core/restore.js';

const cli = path.resolve('dist/cli.js');
async function fixture(t, createHub = true) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "ahub-reset-'space "));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const root = path.join(base, 'hub');
  const targets = ['claude-code', 'codex', 'dsh'].map((id) => ({
    id,
    label: id,
    installed: true,
    file: path.join(
      base,
      'clients',
      id,
      id === 'codex'
        ? 'config.toml'
        : id === 'dsh'
          ? 'profiles/web/cordis.patch.yml'
          : 'config.json',
    ),
  }));
  const config = { command: 'fixture-mcp', args: ['serve'], env: { API_TOKEN: 'fixture-secret' } };
  const originals = {
    'claude-code':
      JSON.stringify({ preferences: { keep: true }, mcpServers: { demo: config } }) + '\n',
    codex: toml({ model: 'fixture', mcp_servers: { demo: config } }),
    dsh: yaml([
      { id: 'preferences', name: 'keep-settings', config: { enabled: true } },
      {
        insert: [
          {
            id: 'demo',
            name: '@deepseek-ai/dsh-mcp-client',
            config: { serverName: 'demo', transport: 'stdio', ...config },
          },
        ],
      },
    ]),
  };
  for (const target of targets) {
    await fs.mkdir(path.dirname(target.file), { recursive: true });
    await fs.writeFile(target.file, originals[target.id], { mode: 0o640 });
  }
  if (createHub) {
    await fs.mkdir(path.join(root, 'mcp'), { recursive: true });
    await fs.writeFile(
      path.join(root, 'hub.yaml'),
      yaml({
        version: 1,
        clients: Object.fromEntries(targets.map((target) => [target.id, { enabled: true }])),
      }),
    );
    await fs.writeFile(path.join(root, '.env'), 'API_TOKEN=fixture-secret\n', { mode: 0o600 });
    await fs.writeFile(
      path.join(root, 'mcp/servers.yaml'),
      yaml({
        version: 1,
        servers: {
          demo: { command: 'fixture-mcp', args: ['serve'], env: { API_TOKEN: '${API_TOKEN}' } },
        },
      }),
    );
    await fs.writeFile(path.join(root, 'unrelated.bin'), Buffer.from([0, 255, 128, 4]));
  }
  const context = { root, targets, cli, node: process.execPath };
  const file = (id) => targets.find((target) => target.id === id).file;
  const env = {
    ...process.env,
    AGENT_HUB_HOME: root,
    AGENT_HUB_CLAUDE_CONFIG: file('claude-code'),
    CLAUDE_CONFIG_DIR: path.dirname(file('claude-code')),
    CODEX_HOME: path.dirname(file('codex')),
    DSH_HOME: path.dirname(path.dirname(path.dirname(file('dsh')))),
    AGENT_HUB_SHARED_SKILLS: path.join(base, 'skills'),
  };
  return { base, root, context, targets, originals, file, env };
}
async function checkOriginals(f) {
  for (const target of f.targets) {
    assert.equal(await fs.readFile(target.file, 'utf8'), f.originals[target.id]);
    assert.equal((await fs.stat(target.file)).mode & 0o777, 0o640);
  }
}

test('reset defaults to preview, redacts payloads and returns clients plus an existing hub to the first checkpoint', async (t) => {
  const f = await fixture(t);
  const originalTree = await inspectTree(f.root);
  await applySync(await planSync({}, f.context));
  const baseline = await readBaseline(f.root);
  assert.equal(baseline.scope, 'existing-hub-checkpoint');
  const plan = await planReset({}, f.root);
  assert.equal(plan.blocked, false);
  assert.equal(plan.files.filter((file) => file.changed).length, 3);
  assert.ok(!JSON.stringify(publicResetPlan(plan)).includes('fixture-secret'));
  await assert.rejects(applyReset(plan), /requires --expect/);
  const result = await applyReset(plan, plan.revision);
  assert.equal(result.restoredFiles, 3);
  await checkOriginals(f);
  assert.equal((await inspectTree(f.root)).fingerprint, originalTree.fingerprint);
  assert.ok(await fs.stat(path.join(result.archive, 'hub')));
  assert.equal((await planReset({}, f.root)).changed, false);
});

test('fresh init can be undone including its Git repository; current hub data is archived rather than deleted', async (t) => {
  const f = await fixture(t, false);
  execFileSync(process.execPath, [cli, 'init', '--yes', '--no-git'], { env: f.env, stdio: 'pipe' });
  assert.equal((await readBaseline(f.root)).scope, 'before-hub-creation');
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: f.root, stdio: 'pipe' });
  await fs.writeFile(path.join(f.root, 'memory/keep.md'), 'user work after setup');
  const plan = await planReset({}, f.root);
  const result = await applyReset(plan, plan.revision);
  await assert.rejects(fs.access(f.root));
  await checkOriginals(f);
  assert.equal(
    await fs.readFile(path.join(result.archive, 'hub/memory/keep.md'), 'utf8'),
    'user work after setup',
  );
  assert.ok(await fs.stat(path.join(result.archive, 'hub/.git')));
  assert.equal((await planReset({}, f.root)).changed, false);
});

test('the first baseline survives multiple syncs and restoration of individual backups', async (t) => {
  const f = await fixture(t);
  const originalTree = await inspectTree(f.root);
  const first = await applySync(await planSync({ client: 'codex' }, f.context));
  const baselineBefore = await fs.readFile(
    path.join(baselineDirectory(f.root), 'manifest.json'),
    'utf8',
  );
  await applySync(await planSync({ client: 'dsh' }, f.context));
  const firstBaseline = JSON.parse(baselineBefore);
  const extended = JSON.parse(
    await fs.readFile(path.join(baselineDirectory(f.root), 'manifest.json'), 'utf8'),
  );
  assert.equal(extended.capturedAt, firstBaseline.capturedAt);
  assert.deepEqual(extended.hub, firstBaseline.hub);
  for (const file of firstBaseline.files)
    assert.deepEqual(
      extended.files.find((entry) => entry.file === file.file),
      file,
    );
  assert.ok(extended.files.some((entry) => entry.file === f.file('dsh')));
  await assert.rejects(applyRestore(await planRestore(first.backup, f.context)), /blocked/);
  const reset = await planReset({}, f.root);
  await applyReset(reset, reset.revision);
  await checkOriginals(f);
  assert.equal((await inspectTree(f.root)).fingerprint, originalTree.fingerprint);
});

test('external client edits block reset by default; explicit archiving preserves them before restoring originals', async (t) => {
  const f = await fixture(t);
  await applySync(await planSync({}, f.context));
  await fs.appendFile(f.file('codex'), '\n# user edit after sync\n');
  const blocked = await planReset({}, f.root);
  assert.equal(blocked.blocked, true);
  await assert.rejects(applyReset(blocked, blocked.revision), /blocked/);
  const plan = await planReset({ archiveChanges: true }, f.root);
  assert.equal(plan.blocked, false);
  const result = await applyReset(plan, plan.revision);
  const archive = JSON.parse(await fs.readFile(path.join(result.archive, 'manifest.json'), 'utf8'));
  const saved = archive.files.find((file) => file.path === f.file('codex'));
  assert.ok(
    (await fs.readFile(path.join(result.archive, saved.payload), 'utf8')).endsWith(
      '# user edit after sync\n',
    ),
  );
  await checkOriginals(f);
});

test('reset refuses stale previews after client edits, mode changes or new hub files', async (t) => {
  const f = await fixture(t);
  await applySync(await planSync({}, f.context));
  const plan = await planReset({}, f.root);
  await fs.writeFile(path.join(f.root, 'new-user-file'), 'new work');
  await assert.rejects(applyReset(plan, plan.revision), /changed/);
  const fresh = await planReset({}, f.root);
  await fs.chmod(f.file('codex'), 0o600);
  await assert.rejects(applyReset(fresh, fresh.revision), /changed/);
  assert.equal((await planReset({}, f.root)).blocked, true);
});

test('reset restores a newly created client file to absence and preserves existing config symlinks', async (t) => {
  const f = await fixture(t);
  await fs.unlink(f.file('claude-code'));
  const real = path.join(f.base, 'actual-codex.toml');
  await fs.rename(f.file('codex'), real);
  await fs.symlink(real, f.file('codex'));
  await applySync(await planSync({}, f.context));
  const plan = await planReset({}, f.root);
  await applyReset(plan, plan.revision);
  await assert.rejects(fs.access(f.file('claude-code')));
  assert.ok((await fs.lstat(f.file('codex'))).isSymbolicLink());
  assert.equal(await fs.readFile(real, 'utf8'), f.originals.codex);
});

test('changed symlink bindings remain blocked even with archive-changes', async (t) => {
  const f = await fixture(t);
  const real = path.join(f.base, 'actual.toml');
  await fs.rename(f.file('codex'), real);
  await fs.symlink(real, f.file('codex'));
  await applySync(await planSync({}, f.context));
  const other = path.join(f.base, 'other.toml');
  await fs.writeFile(other, 'other user file');
  await fs.unlink(f.file('codex'));
  await fs.symlink(other, f.file('codex'));
  assert.equal((await planReset({ archiveChanges: true }, f.root)).blocked, true);
  assert.equal(await fs.readFile(other, 'utf8'), 'other user file');
});

test('corrupted originals prevent reset before any current data changes', async (t) => {
  const f = await fixture(t);
  await applySync(await planSync({}, f.context));
  const before = await fs.readFile(f.file('codex'), 'utf8');
  const baseline = await readBaseline(f.root);
  await fs.appendFile(
    path.join(baselineDirectory(f.root), baseline.files[0].payload),
    'corruption',
  );
  await assert.rejects(planReset({}, f.root), /integrity/);
  assert.equal(await fs.readFile(f.file('codex'), 'utf8'), before);
});

test('a failed hub-directory restoration rolls back client and hub changes', async (t) => {
  const f = await fixture(t);
  await applySync(await planSync({}, f.context));
  const before = await inspectTree(f.root);
  const clientBefore = await fs.readFile(f.file('codex'), 'utf8');
  const plan = await planReset({}, f.root);
  const rename = fs.rename.bind(fs);
  t.mock.method(fs, 'rename', async (from, to) => {
    if (path.basename(from) === 'original-hub' && to === f.root)
      throw new Error('fixture rename failure');
    return rename(from, to);
  });
  await assert.rejects(applyReset(plan, plan.revision), /rolled back/);
  assert.equal(await fs.readFile(f.file('codex'), 'utf8'), clientBefore);
  assert.equal((await inspectTree(f.root)).fingerprint, before.fingerprint);
});

test('a killed sync leaves a recoverable intent journal; reset only recovers locks with a dead owner', async (t) => {
  const f = await fixture(t);
  const target = await fs.realpath(f.file('dsh'));
  const script = path.join(f.base, 'crash.mjs');
  const module = pathToFileURL(path.resolve('dist/core/sync.js')).href;
  await fs.writeFile(
    script,
    `import fs from 'node:fs/promises'; import {planSync,applySync} from ${JSON.stringify(module)}; const rename=fs.rename.bind(fs); fs.rename=async(from,to)=>{await rename(from,to);if(to===${JSON.stringify(target)} && from.includes('.agent-hub-'))process.kill(process.pid,'SIGKILL');}; await applySync(await planSync({},${JSON.stringify(f.context)}));`,
  );
  const result = spawnSync(process.execPath, [script], { encoding: 'utf8', stdio: 'pipe' });
  assert.equal(result.signal, 'SIGKILL');
  assert.equal((await planReset({}, f.root)).blocked, true);
  const plan = await planReset({ recoverLock: true }, f.root);
  assert.ok(plan.locks.some((lock) => lock.status === 'stale'));
  assert.equal(plan.blocked, false);
  await applyReset(plan, plan.revision);
  await checkOriginals(f);
  await withHubLock(f.root, async () => {
    assert.equal((await planReset({ recoverLock: true }, f.root)).blocked, true);
  });
});

test('without a baseline reset never invents history or writes a checkpoint during dry run', async (t) => {
  const f = await fixture(t);
  await assert.rejects(planReset({}, f.root), /cannot be reconstructed/);
  await assert.rejects(fs.access(recoveryRoot(f.root)));
});

test('reset can recover with a corrupt settings file and when the current hub has been removed', async (t) => {
  const f = await fixture(t);
  await applySync(await planSync({}, f.context));
  await fs.writeFile(path.join(f.root, 'hub.yaml'), 'invalid: [');
  const corrupt = await planReset({}, f.root);
  assert.equal(corrupt.blocked, false);
  await fs.rm(f.root, { recursive: true, force: true });
  const missing = await planReset({}, f.root);
  assert.equal(missing.blocked, false);
  await applyReset(missing, missing.revision);
  await checkOriginals(f);
  assert.ok((await fs.readFile(path.join(f.root, 'hub.yaml'), 'utf8')).includes('version: 1'));
});

test('CLI reset preview writes nothing; its exact reviewed command restores originals from an unrelated cwd', async (t) => {
  const f = await fixture(t, false);
  execFileSync(process.execPath, [cli, 'init', '--yes', '--no-git'], { env: f.env, stdio: 'pipe' });
  const before = (await inspectTree(f.root)).fingerprint;
  const preview = JSON.parse(
    execFileSync(process.execPath, [cli, 'reset', '--dry-run', '--json'], {
      env: f.env,
      cwd: os.tmpdir(),
      encoding: 'utf8',
      stdio: 'pipe',
    }),
  );
  assert.equal(preview.blocked, false);
  assert.equal((await inspectTree(f.root)).fingerprint, before);
  assert.throws(() =>
    execFileSync(process.execPath, [cli, 'reset', '--apply'], { env: f.env, stdio: 'pipe' }),
  );
  const result = JSON.parse(
    execFileSync('/bin/sh', ['-c', preview.commands.apply + ' --json'], {
      env: f.env,
      cwd: os.tmpdir(),
      encoding: 'utf8',
      stdio: 'pipe',
    }),
  );
  assert.ok(result.result.archive);
  await assert.rejects(fs.access(f.root));
  await checkOriginals(f);
});

test('unknown lock owners never get removed by reset recovery', async (t) => {
  const f = await fixture(t);
  await applySync(await planSync({}, f.context));
  const lock = path.join(recoveryRoot(f.root), 'operation.lock');
  await fs.writeFile(lock, 'invalid-owner');
  const plan = await planReset({ recoverLock: true }, f.root);
  assert.equal(plan.blocked, true);
  await assert.rejects(applyReset(plan, plan.revision), /blocked/);
  assert.equal(await fs.readFile(lock, 'utf8'), 'invalid-owner');
});

test('a new DSH profile gets its own first-touch original without replacing earlier baseline records', async (t) => {
  const f = await fixture(t);
  await applySync(await planSync({}, f.context));
  const initial = await readBaseline(f.root);
  const alternate = path.join(f.base, 'clients/dsh/profiles/other/cordis.patch.yml');
  await fs.mkdir(path.dirname(alternate), { recursive: true });
  await fs.writeFile(alternate, f.originals.dsh);
  const context = {
    ...f.context,
    targets: f.targets.map((target) =>
      target.id === 'dsh' ? { ...target, file: alternate } : target,
    ),
  };
  await applySync(await planSync({ client: 'dsh' }, context));
  const extended = await readBaseline(f.root);
  assert.equal(extended.capturedAt, initial.capturedAt);
  assert.equal(extended.files.length, initial.files.length + 1);
  const plan = await planReset({}, f.root);
  await applyReset(plan, plan.revision);
  await checkOriginals(f);
  assert.equal(await fs.readFile(alternate, 'utf8'), f.originals.dsh);
});

test('baseline copies symlinks without following arbitrary external directories', async (t) => {
  const f = await fixture(t);
  const external = path.join(f.base, 'external');
  await fs.mkdir(external);
  await fs.writeFile(path.join(external, 'file'), 'before');
  await fs.symlink(external, path.join(f.root, 'shared-skill'));
  await applySync(await planSync({}, f.context));
  await fs.writeFile(path.join(external, 'file'), 'external user work');
  const plan = await planReset({}, f.root);
  await applyReset(plan, plan.revision);
  assert.ok((await fs.lstat(path.join(f.root, 'shared-skill'))).isSymbolicLink());
  assert.equal(await fs.readFile(path.join(external, 'file'), 'utf8'), 'external user work');
});

test('symlinked recovery storage is rejected without writing to its target', async (t) => {
  const f = await fixture(t);
  const other = path.join(f.base, 'other-storage');
  await fs.mkdir(other);
  await fs.symlink(other, recoveryRoot(f.root));
  await assert.rejects(applySync(await planSync({}, f.context)), /real private directory/);
  assert.deepEqual(await fs.readdir(other), []);
  await checkOriginals(f);
});

test('reset can finish after a process is killed immediately after archiving the active hub', async (t) => {
  for (const fresh of [false, true]) {
    const f = await fixture(t, !fresh);
    if (fresh)
      execFileSync(process.execPath, [cli, 'init', '--yes', '--no-git'], {
        env: f.env,
        stdio: 'pipe',
      });
    else await applySync(await planSync({}, f.context));
    const script = path.join(f.base, 'crash-reset.mjs');
    const module = pathToFileURL(path.resolve('dist/core/reset.js')).href;
    await fs.writeFile(
      script,
      `import fs from 'node:fs/promises'; import {planReset,applyReset} from ${JSON.stringify(module)}; const rename=fs.rename.bind(fs); fs.rename=async(from,to)=>{await rename(from,to);if(from===${JSON.stringify(f.root)})process.kill(process.pid,'SIGKILL');}; const plan=await planReset({},${JSON.stringify(f.root)}); await applyReset(plan,plan.revision);`,
    );
    const result = spawnSync(process.execPath, [script], { stdio: 'pipe' });
    assert.equal(result.signal, 'SIGKILL');
    await assert.rejects(fs.access(f.root));
    const recovery = await planReset({ recoverLock: true }, f.root);
    assert.equal(recovery.blocked, false);
    await applyReset(recovery, recovery.revision);
    await checkOriginals(f);
    if (fresh) await assert.rejects(fs.access(f.root));
    else
      assert.ok((await fs.readFile(path.join(f.root, 'hub.yaml'), 'utf8')).includes('version: 1'));
    await assert.rejects(fs.access(path.join(recoveryRoot(f.root), 'operation.lock')));
  }
});

test('unrecognized pre-existing recovery directories are left untouched', async (t) => {
  const f = await fixture(t);
  await fs.mkdir(recoveryRoot(f.root));
  await fs.writeFile(path.join(recoveryRoot(f.root), '.gitignore'), 'user-owned data');
  await assert.rejects(applySync(await planSync({}, f.context)), /unrecognized data/);
  assert.equal(
    await fs.readFile(path.join(recoveryRoot(f.root), '.gitignore'), 'utf8'),
    'user-owned data',
  );
  await checkOriginals(f);
});

test('out-of-space during baseline capture stops before managed writes and a later retry remains recoverable', async (t) => {
  const f = await fixture(t);
  const copy = fs.copyFile.bind(fs);
  const mocked = t.mock.method(fs, 'copyFile', async (from, to, flags) => {
    if (path.basename(from) === '.env')
      throw Object.assign(new Error('fixture disk full'), { code: 'ENOSPC' });
    return copy(from, to, flags);
  });
  await assert.rejects(applySync(await planSync({}, f.context)), /disk full/);
  await checkOriginals(f);
  assert.equal(await readBaseline(f.root), null);
  await assert.rejects(fs.access(path.join(recoveryRoot(f.root), 'operation.lock')));
  mocked.mock.restore();
  await applySync(await planSync({}, f.context));
  const reset = await planReset({}, f.root);
  await applyReset(reset, reset.revision);
  await checkOriginals(f);
});

test('out-of-space while archiving current files stops reset before altering the hub or clients', async (t) => {
  const f = await fixture(t);
  await applySync(await planSync({}, f.context));
  const beforeHub = await inspectTree(f.root);
  const beforeClient = await fs.readFile(f.file('codex'), 'utf8');
  const plan = await planReset({}, f.root);
  const write = fs.writeFile.bind(fs);
  t.mock.method(fs, 'writeFile', async (file, ...args) => {
    if (
      String(file).includes('archives' + path.sep + 'reset-') &&
      path.basename(String(file)) === '0.txt'
    )
      throw Object.assign(new Error('fixture disk full'), { code: 'ENOSPC' });
    return write(file, ...args);
  });
  await assert.rejects(applyReset(plan, plan.revision), /disk full/);
  assert.equal((await inspectTree(f.root)).fingerprint, beforeHub.fingerprint);
  assert.equal(await fs.readFile(f.file('codex'), 'utf8'), beforeClient);
});

test('failed automatic rollback reports manual recovery and retains data for a subsequent reset', async (t) => {
  const f = await fixture(t);
  await applySync(await planSync({}, f.context));
  const plan = await planReset({}, f.root);
  const rename = fs.rename.bind(fs);
  const mocked = t.mock.method(fs, 'rename', async (from, to) => {
    if (to === f.root && ['original-hub', 'hub'].includes(path.basename(from)))
      throw new Error('fixture installation and rollback failure');
    return rename(from, to);
  });
  await assert.rejects(applyReset(plan, plan.revision), /manual review/);
  mocked.mock.restore();
  const retry = await planReset({}, f.root);
  await applyReset(retry, retry.revision);
  await checkOriginals(f);
  const archives = await fs.readdir(path.join(recoveryRoot(f.root), 'archives'));
  assert.ok(archives.length >= 2);
});

test('reset removes only the empty parent directories that sync created', async (t) => {
  const f = await fixture(t);
  const created = path.join(f.base, 'new-client/profiles/new/config.yml');
  const context = {
    ...f.context,
    targets: f.targets.map((target) =>
      target.id === 'dsh' ? { ...target, file: created } : target,
    ),
  };
  await applySync(await planSync({ client: 'dsh' }, context));
  assert.ok(await fs.stat(created));
  const plan = await planReset({}, f.root);
  assert.ok(
    publicResetPlan(plan).directories.some(
      (entry) => entry.action === 'remove-created-empty-directory',
    ),
  );
  await applyReset(plan, plan.revision);
  await assert.rejects(fs.access(path.join(f.base, 'new-client')));
  await checkOriginals(f);
});

test('reset keeps user data inside directories originally created by sync', async (t) => {
  const f = await fixture(t);
  const created = path.join(f.base, 'new-client/profiles/new/config.yml');
  const context = {
    ...f.context,
    targets: f.targets.map((target) =>
      target.id === 'dsh' ? { ...target, file: created } : target,
    ),
  };
  await applySync(await planSync({ client: 'dsh' }, context));
  const note = path.join(path.dirname(created), 'user.txt');
  await fs.writeFile(note, 'new user work');
  const plan = await planReset({}, f.root);
  assert.ok(publicResetPlan(plan).directories.some((entry) => entry.action === 'keep-user-data'));
  await applyReset(plan, plan.revision);
  assert.equal(await fs.readFile(note, 'utf8'), 'new user work');
  await assert.rejects(fs.access(created));
});

test('reset restores a pre-existing Git hub including its original HEAD and staged work', async (t) => {
  const f = await fixture(t);
  const git = (args) => execFileSync('git', args, { cwd: f.root, encoding: 'utf8', stdio: 'pipe' });
  git(['init', '-q', '-b', 'main']);
  git(['config', 'user.name', 'Fixture']);
  git(['config', 'user.email', 'fixture@example.com']);
  git(['config', 'commit.gpgsign', 'false']);
  git(['config', 'core.hooksPath', path.join(f.base, 'disabled-hooks')]);
  await fs.writeFile(path.join(f.root, 'notes.md'), 'initial project notes');
  git(['add', 'notes.md']);
  git(['commit', '-qm', 'initial state']);
  await fs.writeFile(path.join(f.root, 'pending.txt'), 'user staged work');
  git(['add', 'pending.txt']);
  const head = git(['rev-parse', 'HEAD']);
  const tree = await inspectTree(f.root);
  execFileSync(process.execPath, [cli, 'init', '--yes'], { env: f.env, stdio: 'pipe' });
  const importPreview = JSON.parse(
    execFileSync(process.execPath, [cli, 'import', 'mcp', '--overwrite', '--json'], {
      env: f.env,
      encoding: 'utf8',
    }),
  );
  execFileSync(
    process.execPath,
    [cli, 'import', 'mcp', '--overwrite', '--apply', '--expect', importPreview.revision, '--json'],
    {
      env: f.env,
      stdio: 'pipe',
    },
  );
  const plan = await planReset({}, f.root);
  await applyReset(plan, plan.revision);
  assert.equal((await inspectTree(f.root)).fingerprint, tree.fingerprint);
  assert.equal(git(['rev-parse', 'HEAD']), head);
  assert.equal(git(['diff', '--cached', '--name-only']).trim(), 'pending.txt');
  await checkOriginals(f);
});
