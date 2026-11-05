// Optional compatibility check against an explicitly selected local DSH installation.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { planMemoryProject } from '../dist/core/projects/memory-bindings.js';
import { planAutomationSetup } from '../dist/core/memory/automation/setup.js';
import { applyManagedPlan } from '../dist/core/recovery/managed-plan.js';
import { automaticCheckpoint } from '../dist/core/memory/automation/runtime.js';
import { createMemorySession } from '../dist/core/memory/session.js';
import * as adapter from '../dist/integrations/dsh-memory.js';

const packageDirectory = process.argv[2];
if (!packageDirectory || !path.isAbsolute(packageDirectory))
  throw new Error('Usage: node scripts/check-dsh.mjs /absolute/path/to/installed/dsh');
const requireDsh = createRequire(path.join(packageDirectory, 'package.json'));
const { Context } = await import(pathToFileURL(requireDsh.resolve('@deepseek-ai/cordis')));
const { Session, SESSION_FORMAT_VERSION } = await import(
  pathToFileURL(requireDsh.resolve('@deepseek-ai/dsh-session'))
);
const { version } = JSON.parse(
  await fs.readFile(path.join(packageDirectory, 'package.json'), 'utf8'),
);
const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'ahub-dsh-check-')));
const ctx = new Context();
try {
  const root = path.join(directory, 'hub');
  const workspace = path.join(directory, 'project');
  await fs.mkdir(root);
  await fs.mkdir(workspace);
  await fs.writeFile(path.join(root, 'hub.yaml'), 'version: 1\n');
  await promisify(execFile)('git', ['init', '-q', workspace]);
  const apply = async (build) => {
    const plan = await build();
    return applyManagedPlan(plan, build, plan.revision);
  };
  await apply(() => planMemoryProject(root, 'example', workspace));
  await apply(() =>
    planAutomationSetup(root, workspace, 'dsh', {
      hookFile: path.join(directory, 'legacy-hooks.json'),
      dshPatch: path.join(directory, 'cordis.patch.yml'),
    }),
  );
  const session = Session.create('compatibility-session', [], {
    version: SESSION_FORMAT_VERSION,
    id: 'compatibility-session',
    createdAt: Date.now(),
    cwd: workspace,
    isSeeded: false,
  });
  const injected = [];
  const steered = [];
  const agent = {
    id: session.id,
    session,
    inject(message) {
      session.append('user/message', message, { surfaceOp: 'append' });
      injected.push(message);
    },
    steer(message) {
      session.append('user/message', message, { surfaceOp: 'append' });
      steered.push(message);
    },
  };
  await ctx.plugin(adapter, { root });
  await ctx.serial('agent/created', { agent, source: 'create' });
  assert.equal(injected.length, 1);
  assert.match(injected[0].content[0].text, /project memory is enabled/);
  const enter = () => Promise.resolve({ kind: 'enter' });
  await ctx.waterfall(
    'agent/pre-step',
    {
      agent,
      messages: [
        { source: { kind: 'user' }, content: [{ type: 'text', text: 'Check the API contract.' }] },
      ],
    },
    enter,
  );
  await ctx.serial('agent/turn-stopping', { agent });
  assert.equal(steered.length, 1);
  const token = /checkpoint:([a-f0-9]{32})/.exec(steered[0].content[0].text)?.[1];
  assert.ok(token);
  await ctx.waterfall('agent/pre-step', { agent, messages: steered }, enter);
  await ctx.serial('agent/turn-stopping', { agent });
  assert.equal(steered.length, 1, 'The injected checkpoint never resets the loop guard');
  const saved = await automaticCheckpoint(root, workspace, 'dsh', token, {
    session: agent.id,
    facts: [
      {
        key: 'api-retries',
        title: 'API retries',
        body: 'Use idempotency keys.',
        kind: 'fact',
        evidence: 'Verified contract.',
      },
    ],
  });
  assert.equal(saved.saved, 1);
  const reader = createMemorySession({ root, workspace });
  const listed = await reader.list();
  assert.equal(listed.total, 1);
  assert.equal((await reader.get(listed.results[0].id)).body, 'Use idempotency keys.');
  console.log(
    `DSH ${version}: native Cordis events, session message validation, bounded continuation and shared memory reads passed.`,
  );
} finally {
  await ctx.fiber.dispose();
  await fs.rm(directory, { recursive: true, force: true });
}
