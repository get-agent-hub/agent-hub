// A manual UI test environment. All writable client files live in one temporary directory.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { stringify as yaml } from 'yaml';
import { stringify as toml } from 'smol-toml';
import { startUiServer } from '../dist/ui/server.js';
import { uiState, skillDocument } from '../dist/ui/data.js';
import { readDefinitions } from '../dist/core/config-edit.js';
import { listSkills } from '../dist/core/fs.js';
import { toMcpEntry } from '../dist/core/mcp.js';
import { planImport } from '../dist/core/import-plan.js';
import { planSync } from '../dist/core/sync.js';
import { runDoctor } from '../dist/core/doctor.js';

const project = fileURLToPath(new URL('../', import.meta.url));
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-hub-qa-'));
const hub = path.join(root, 'hub');
process.env.AGENT_HUB_HOME = hub;
const cli = path.join(project, 'dist/cli.js');
const worker = path.join(project, 'dist/core/doctor-worker.js');
const fixture = path.join(project, 'tests/fixtures/doctor-server.mjs');
const ids = ['claude-code', 'codex', 'dsh'];
const labels = ['Claude Code', 'Codex CLI', 'DeepSeek Harness'];
const targets = ids.map((id, i) => ({
  id,
  label: labels[i],
  file: path.join(
    root,
    'clients',
    id,
    id === 'codex' ? 'config.toml' : id === 'dsh' ? 'cordis.patch.yml' : 'config.json',
  ),
  installed: true,
}));
for (const dir of ['skills/qa-skill', 'mcp', 'instructions', 'memory', 'state'])
  await fs.mkdir(path.join(hub, dir), { recursive: true });
await fs.writeFile(
  path.join(hub, 'hub.yaml'),
  yaml({ version: 1, clients: Object.fromEntries(ids.map((id) => [id, { enabled: true }])) }),
);
await fs.writeFile(path.join(hub, '.env'), '# QA fixture credentials only\n', { mode: 0o600 });
await fs.writeFile(path.join(hub, 'mcp/servers.yaml'), 'version: 1\nservers: {}\n');
await fs.writeFile(path.join(hub, '.gitignore'), '.env\nstate/\nbackups/\n');
await fs.writeFile(
  path.join(hub, 'skills/qa-skill/SKILL.md'),
  '---\nname: qa-skill\ndescription: Test shared instructions and source selection.\n---\n# QA skill\n\nUse only the temporary fixture repository.\n\n<script>This must remain text, not executable HTML.</script>\n',
);
await fs.writeFile(
  path.join(hub, 'instructions/AGENTS.md'),
  '# Shared QA rules\n\nPreserve unrelated client settings.\n',
);
await fs.writeFile(
  path.join(hub, 'memory/decision.md'),
  '# QA decision\n\nThe hub is the source of truth.\n',
);
await fs.writeFile(
  path.join(hub, 'memory/handoff.md'),
  '# Handoff\n\nCurrent task: test imports, sync, doctor and restore.\n',
);
const repo = path.join(root, 'qa-project');
await fs.mkdir(path.join(repo, '.agents/state'), { recursive: true });
execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repo });
await fs.writeFile(
  path.join(repo, 'AGENTS.md'),
  '# QA project\n\nRead the project context before editing.\n',
);
await fs.writeFile(
  path.join(repo, '.agents/state/PROJECT.md'),
  '# Project\n\nA local integration-test workspace.\n',
);
await fs.writeFile(
  path.join(repo, '.agents/state/NOW.md'),
  '# Task: Verify Agent Hub\n\nNext: import → dry run → sync → doctor → restore.\n',
);
const base = {
  command: process.execPath,
  args: [fixture],
  env: {
    FIXTURE_MODE: 'healthy',
    API_TOKEN: 'qa-fixture-secret-1234567890',
    FIXTURE_METHODS: path.join(root, 'methods.log'),
  },
};
const originals = {};
for (const target of targets) {
  await fs.mkdir(path.dirname(target.file), { recursive: true });
  await fs.mkdir(path.join(path.dirname(target.file), 'skills'));
  await fs.symlink(
    path.join(hub, 'skills/qa-skill'),
    path.join(path.dirname(target.file), 'skills/qa-skill'),
  );
  const defs = { 'qa-demo': structuredClone(base) };
  if (target.id === 'codex') {
    defs['qa-demo'].tools = { write: { approval_mode: 'prompt' } };
    defs['qa-empty'] = {
      command: process.execPath,
      args: [fixture],
      env: { FIXTURE_MODE: 'empty' },
    };
    defs['qa-timeout'] = {
      command: process.execPath,
      args: [fixture],
      env: { FIXTURE_MODE: 'tools-hang' },
    };
  }
  if (target.id !== 'dsh')
    defs['qa-choice'] = { ...structuredClone(base), env: { ...base.env, SOURCE: target.id } };
  let raw;
  if (target.id === 'codex')
    raw =
      '# Preserve this comment\n' +
      toml({
        model: 'qa-model',
        mcp_servers: defs,
        projects: { [repo]: { trust_level: 'trusted' } },
      });
  else if (target.id === 'dsh')
    raw =
      '# Preserve this comment\n' +
      yaml([
        { id: 'qa-ui', name: 'keep-ui-preferences', config: { theme: 'dark' } },
        {
          insert: Object.entries(defs).map(([name, config]) => ({
            id: `qa-${name}`,
            name: '@deepseek-ai/dsh-mcp-client',
            config: { serverName: name, transport: 'stdio', ...config },
          })),
        },
      ]);
  else
    raw =
      JSON.stringify({ theme: 'dark', unrelated: { keep: true }, mcpServers: defs }, null, 2) +
      '\n';
  await fs.writeFile(target.file, raw, { mode: 0o600 });
  originals[target.id] = raw;
}
const sources = targets.map((target) => ({
  id: target.id,
  label: target.label,
  detect: async () => ({
    installed: true,
    paths: { config: target.file, skills: path.join(path.dirname(target.file), 'skills') },
  }),
  async readMcpRaw() {
    return [...readDefinitions(target.id, await fs.readFile(target.file, 'utf8'))].map(
      ([name, raw]) => ({ name, raw, source: target.file }),
    );
  },
  async read() {
    return {
      client: target.id,
      skills: await listSkills(path.join(path.dirname(target.file), 'skills')),
      mcp: (await this.readMcpRaw()).map((r) => toMcpEntry(r.name, r.raw, r.source)),
    };
  },
}));
const context = { root: hub, targets, node: process.execPath, cli };
const doctorContext = {
  root: hub,
  node: process.execPath,
  cli,
  worker,
  skillRoots: [{ client: 'hub', path: path.join(hub, 'skills') }],
};
const info = { root, hub, repo, context, originals };
await fs.writeFile(path.join(root, 'qa-info.json'), JSON.stringify(info, null, 2));
const portArg = process.argv.indexOf('--port');
const port = portArg >= 0 ? Number(process.argv[portArg + 1]) : 3083;
const ui = await startUiServer({
  port,
  cwd: repo,
  services: {
    state: () => uiState(repo, sources),
    skill: (name, source) => skillDocument(name, source, sources),
    plan: (item, opts) => planImport(item, opts, sources),
    syncPlan: (opts) => planSync(opts, context),
    doctor: (opts, _, control) => runDoctor(opts, doctorContext, control),
  },
});
console.log(
  `QA UI: ${ui.url}\nFixture: ${root}\nOnly temporary client configs are writable through this instance.\nRestore is tested using the shared restore engine and this fixture context.\nCtrl+C stops the server. The fixture is retained for inspection.`,
);
let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM'])
  process.once(signal, async () => {
    if (stopping) return;
    stopping = true;
    await ui.close();
    process.exit(0);
  });
