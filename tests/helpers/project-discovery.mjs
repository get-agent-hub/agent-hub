import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { claudeSessions } from '../../dist/adapters/claude-sessions.js';
import { startUiServer } from '../../dist/ui/server.js';

export async function fixture(t) {
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

export function git(cwd, ...args) {
  return execFileSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

export async function snapshot(root) {
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

export const limits = { entries: 1000, files: 1000, bytes: 1024 * 1024, prefix: 1024 * 1024 };

export const tick = () => new Promise((resolve) => setImmediate(resolve));

export const minimalReport = (projects = [], coverage = 'complete') => ({
  metadataOnly: true,
  coverage,
  finished: true,
  checkedAt: new Date().toISOString(),
  sources: [],
  issues: [],
  projects,
});

export function isolateEnvironment(t, values) {
  const saved = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  Object.assign(process.env, values);
  t.after(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

export async function clientUi(t, f, services = {}) {
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

export async function completed(post, id) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const response = await post('/api/projects/discovery/status', { id });
    assert.equal(response.status, 200);
    const report = await response.json();
    if (report.state !== 'running') return report;
    await tick();
  }
  throw new Error('Fixture scan did not complete');
}
