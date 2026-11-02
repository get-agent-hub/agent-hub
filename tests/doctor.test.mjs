import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { stringify } from 'yaml';
import http from 'node:http';
import { runDoctor, cachedDoctor } from '../dist/core/doctor.js';
import { checkService } from '../dist/core/doctor-service.js';
import { n8nReadiness } from '../dist/integrations/health-checks.js';
const checkN8nService = (env, timeout, signal) => checkService(n8nReadiness(env), timeout, signal);
import { startUiServer } from '../dist/ui/server.js';

const secret = 'doctor-test-super-private-session-value';
const cli = path.resolve('dist/cli.js');
const worker = path.resolve('dist/core/doctor-worker.js');
const server = path.resolve('tests/fixtures/doctor-server.mjs');

async function fixture(t, modes = { demo: 'healthy' }) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ahub-doctor-'space "));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'mcp'));
  await fs.writeFile(path.join(root, '.env'), `DOCTOR_TOKEN=${secret}\n`, { mode: 0o600 });
  const servers = Object.fromEntries(
    Object.entries(modes).map(([name, mode]) => [
      name,
      {
        command: process.execPath,
        args: [server],
        env: {
          FIXTURE_MODE: mode,
          API_TOKEN: '${DOCTOR_TOKEN}',
          FIXTURE_METHODS: path.join(root, `${name}-methods.log`),
          FIXTURE_PIDS: path.join(root, `${name}-pids.log`),
        },
      },
    ]),
  );
  const registry = path.join(root, 'mcp', 'servers.yaml');
  const write = () => fs.writeFile(registry, stringify({ version: 1, servers }));
  await write();
  const context = {
    root,
    cli,
    worker,
    node: process.execPath,
    skillRoots: [{ client: 'hub', path: path.join(root, 'skills') }],
  };
  return { root, context, registry, servers, write };
}

async function until(get, timeout = 4000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await get();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  throw new Error('Condition did not complete within test deadline');
}

test('real launcher and SDK initialize, collect all tool pages, and never call tools', async (t) => {
  const f = await fixture(t);
  const original = await fs.readFile(f.registry, 'utf8');
  const report = await runDoctor({ timeout: 4 }, f.context);
  assert.equal(report.summary.ok, 1);
  assert.equal(report.results[0].tools, 3);
  assert.equal(report.results[0].pages, 2);
  assert.equal(report.results[0].phase, 'tools/list');
  assert.ok(report.results[0].durationMs > 0);
  const methods = (await fs.readFile(path.join(f.root, 'demo-methods.log'), 'utf8'))
    .trim()
    .split('\n');
  assert.deepEqual(methods.slice(0, 4), [
    'initialize',
    'notifications/initialized',
    'tools/list',
    'tools/list',
  ]);
  assert.ok(!methods.includes('tools/call'));
  assert.equal(await fs.readFile(f.registry, 'utf8'), original);
  assert.ok(!JSON.stringify(report).includes(secret));
  const cache = path.join(f.root, 'state', 'doctor.json');
  assert.equal((await fs.stat(cache)).mode & 0o777, 0o600);
  assert.equal((await cachedDoctor(f.context)).stale, false);
  await fs.appendFile(path.join(f.root, '.env'), 'NEW_VALUE=changed\n');
  assert.equal((await cachedDoctor(f.context)).stale, true);
});

test('zero tools and resource-only servers are valid, with different discovery evidence', async (t) => {
  const f = await fixture(t, { empty: 'empty', resources: 'resources' });
  const report = await runDoctor({ timeout: 4, save: false }, f.context);
  assert.equal(report.summary.ok, 2);
  const empty = report.results.find((r) => r.name === 'empty');
  const resources = report.results.find((r) => r.name === 'resources');
  assert.equal(empty.tools, 0);
  assert.equal(empty.phase, 'tools/list');
  assert.equal(resources.tools, null);
  assert.equal(resources.phase, 'initialize');
  assert.match(resources.note, /does not advertise tools/);
  await assert.rejects(fs.access(path.join(f.root, 'state')));
});

test('checking one server retains other current results in the shared UI cache', async (t) => {
  const f = await fixture(t, { first: 'healthy', second: 'empty' });
  await runDoctor({ timeout: 4 }, f.context);
  const selected = await runDoctor({ name: 'second', timeout: 4 }, f.context);
  assert.equal(selected.results.length, 1);
  const cache = await cachedDoctor(f.context);
  assert.equal(cache.report.results.length, 2);
  assert.equal(cache.report.summary.ok, 2);
  assert.equal(cache.report.results.find((r) => r.name === 'first').tools, 3);
});

test('redacts server errors and stderr while classifying auth, network and protocol failures', async (t) => {
  const f = await fixture(t, {
    auth: 'auth',
    network: 'network',
    malformed: 'malformed',
    loop: 'loop',
  });
  const report = await runDoctor({ timeout: 4 }, f.context);
  assert.equal(report.summary.failed, 4);
  for (const [name, kind] of [
    ['auth', 'auth'],
    ['network', 'network'],
    ['malformed', 'protocol'],
    ['loop', 'protocol'],
  ]) {
    assert.equal(report.results.find((r) => r.name === name).error.kind, kind);
  }
  const saved = await fs.readFile(path.join(f.root, 'state', 'doctor.json'), 'utf8');
  assert.ok(!saved.includes(secret));
  assert.ok(!saved.includes('private.invalid'));
  assert.ok(!saved.includes('Authorization:'));
});

test('preflight catches missing credentials and executables without spawning them', async (t) => {
  const f = await fixture(t, { missingEnv: 'healthy', missingCommand: 'healthy' });
  f.servers.missingEnv.env.API_TOKEN = '${DOCTOR_UNSET_TOKEN}';
  f.servers.missingCommand.command = path.join(f.root, 'no-such-executable');
  await f.write();
  const report = await runDoctor({ timeout: 4 }, f.context);
  assert.equal(report.results.find((r) => r.name === 'missingEnv').error.kind, 'missing-env');
  assert.equal(report.results.find((r) => r.name === 'missingCommand').error.kind, 'not-found');
  for (const name of ['missingEnv', 'missingCommand'])
    await assert.rejects(fs.access(path.join(f.root, `${name}-pids.log`)));
});

test('distinguishes a broken package cache from an unavailable remote service without exposing logs', async (t) => {
  const f = await fixture(t, { cache: 'package-cache', offline: 'unavailable' });
  const report = await runDoctor({ timeout: 4 }, f.context);
  assert.equal(report.results.find((r) => r.name === 'cache').error.kind, 'package-cache');
  assert.equal(report.results.find((r) => r.name === 'offline').error.kind, 'unavailable');
  assert.ok(!JSON.stringify(report).includes(secret));
  assert.ok(!JSON.stringify(report).includes('/private/node_modules'));
});

test('n8n readiness is a separate warning; a stopped backend does not fail a healthy MCP and recovers on recheck', async (t) => {
  const requests = [];
  let status = 503;
  const backend = http.createServer((req, res) => {
    requests.push({ url: req.url, headers: req.headers });
    res.writeHead(status);
    res.end('private-backend-body');
  });
  await new Promise((resolve) => backend.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => backend.close(resolve)));
  const f = await fixture(t);
  const url = `http://127.0.0.1:${backend.address().port}/n8n/?token=${secret}#private-fragment`;
  f.servers.demo.env.N8N_API_URL = url;
  await f.write();
  const before = await fs.readFile(f.registry, 'utf8');
  const offline = await runDoctor({ timeout: 4 }, f.context);
  assert.equal(offline.summary.ok, 1);
  assert.equal(offline.summary.failed, 0);
  assert.equal(offline.summary.warnings, 1);
  assert.equal(offline.results[0].service.status, 'unavailable');
  assert.equal(offline.results[0].service.httpStatus, 503);
  assert.equal(offline.results[0].tools, 3);
  status = 200;
  const recovered = await runDoctor({ timeout: 4 }, f.context);
  assert.equal(recovered.results[0].service.status, 'ready');
  assert.equal(recovered.summary.warnings, 0);
  assert.equal((await cachedDoctor(f.context)).report.results[0].service.status, 'ready');
  assert.equal(await fs.readFile(f.registry, 'utf8'), before);
  assert.equal(requests.length, 2);
  for (const req of requests) {
    assert.equal(req.url, '/n8n/healthz/readiness');
    assert.equal(req.headers.authorization, undefined);
    assert.equal(req.headers['x-n8n-api-key'], undefined);
    assert.ok(!JSON.stringify(req).includes(secret));
  }
  const saved = await fs.readFile(path.join(f.root, 'state/doctor.json'), 'utf8');
  assert.ok(!saved.includes(secret));
  assert.ok(!saved.includes(url));
  assert.ok(!saved.includes('private-backend-body'));
});

test('n8n readiness does not follow redirects or mistake protected/hidden endpoints for an outage', async (t) => {
  let status = 302;
  let requests = 0;
  const backend = http.createServer((req, res) => {
    requests++;
    res.writeHead(status, { Location: '/unexpected' });
    res.end();
  });
  await new Promise((resolve) => backend.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => backend.close(resolve)));
  const env = { N8N_API_URL: `http://127.0.0.1:${backend.address().port}` };
  for (status of [302, 401, 403, 404])
    assert.equal((await checkN8nService(env, 1000)).status, 'unknown');
  assert.equal(requests, 4);
  assert.equal((await checkN8nService({ N8N_API_URL: 'file:///private' }, 1000)).status, 'unknown');
  assert.equal(
    (await checkN8nService({ N8N_API_URL: `http://user:${secret}@127.0.0.1` }, 1000)).status,
    'unknown',
  );
  assert.equal(await checkN8nService({}, 1000), undefined);
  assert.equal(requests, 4);
});

test('n8n readiness deadlines and cancellation also stop an unresponsive HTTP check', async (t) => {
  const backend = http.createServer(() => {});
  await new Promise((resolve) => backend.listen(0, '127.0.0.1', resolve));
  t.after(() => {
    backend.closeAllConnections();
    return new Promise((resolve) => backend.close(resolve));
  });
  const env = { N8N_API_URL: `http://127.0.0.1:${backend.address().port}` };
  const start = Date.now();
  assert.equal((await checkN8nService(env, 100)).status, 'unavailable');
  assert.ok(Date.now() - start < 1500);
  const controller = new AbortController();
  const pending = checkN8nService(env, 3000, controller.signal);
  controller.abort();
  assert.equal(await pending, undefined);
});

test('n8n readiness explains DNS, refused connections and TLS errors without leaking exception text', async (t) => {
  let code;
  t.mock.method(globalThis, 'fetch', async () => {
    throw Object.assign(new Error(`private error ${secret}`), { cause: { code } });
  });
  for (const [value, expected] of [
    ['ENOTFOUND', /DNS/],
    ['EAI_AGAIN', /DNS/],
    ['ECONNREFUSED', /refused/],
    ['CERT_HAS_EXPIRED', /TLS/],
    ['ECONNRESET', /could not be reached/],
  ]) {
    code = value;
    const result = await checkN8nService({ N8N_API_URL: 'https://private.invalid' }, 1000);
    assert.equal(result.status, 'unavailable');
    assert.match(result.message, expected);
    assert.ok(!JSON.stringify(result).includes(secret));
    assert.ok(!JSON.stringify(result).includes('private.invalid'));
  }
});

test('respects client scopes, disabled definitions and app-owned servers', async (t) => {
  const f = await fixture(t, { restricted: 'healthy', disabled: 'healthy', node_repl: 'healthy' });
  f.servers.restricted.only = ['codex'];
  f.servers.disabled.clients = { dsh: { enabled: false } };
  f.servers.node_repl.command = '/Applications/ChatGPT.app/Contents/Resources/node_repl';
  await f.write();
  const report = await runDoctor({ client: 'dsh', timeout: 4 }, f.context);
  assert.equal(report.summary.skipped, 3);
  assert.equal(report.summary.failed, 0);
  for (const name of Object.keys(f.servers))
    await assert.rejects(fs.access(path.join(f.root, `${name}-pids.log`)));
});

test('deadline covers startup and listing; forced cleanup also stops stubborn descendants', async (t) => {
  const f = await fixture(t, { hang: 'hang', listing: 'tools-hang' });
  const report = await runDoctor({ timeout: 1.5, concurrency: 2 }, f.context);
  assert.equal(report.summary.failed, 2);
  assert.ok(report.durationMs < 4500);
  assert.equal(report.results.find((r) => r.name === 'hang').error.kind, 'timeout');
  assert.equal(report.results.find((r) => r.name === 'listing').phase, 'tools/list');
  const pids = (await fs.readFile(path.join(f.root, 'hang-pids.log'), 'utf8'))
    .trim()
    .split('\n')
    .map(Number);
  assert.equal(pids.length, 2);
  await until(async () =>
    pids.every((pid) => {
      try {
        process.kill(pid, 0);
        return false;
      } catch {
        return true;
      }
    }),
  );
});

test('cancellation stops the active process group and marks queued checks cancelled', async (t) => {
  const f = await fixture(t, { a: 'hang', b: 'healthy' });
  const controller = new AbortController();
  const pending = runDoctor({ timeout: 6, concurrency: 1 }, f.context, {
    signal: controller.signal,
  });
  await until(async () =>
    fs
      .readFile(path.join(f.root, 'a-pids.log'), 'utf8')
      .then((s) => s.trim().split('\n').length === 2)
      .catch(() => false),
  );
  controller.abort();
  const report = await pending;
  assert.equal(report.summary.cancelled, 2);
  await assert.rejects(fs.access(path.join(f.root, 'b-pids.log')));
  const pids = (await fs.readFile(path.join(f.root, 'a-pids.log'), 'utf8'))
    .trim()
    .split('\n')
    .map(Number);
  await until(async () =>
    pids.every((pid) => {
      try {
        process.kill(pid, 0);
        return false;
      } catch {
        return true;
      }
    }),
  );
});

test('local warnings identify private-file permissions and broken skill links', async (t) => {
  const f = await fixture(t, {});
  await fs.chmod(path.join(f.root, '.env'), 0o644);
  await fs.mkdir(path.join(f.root, 'skills'));
  await fs.symlink(path.join(f.root, 'does-not-exist'), path.join(f.root, 'skills', 'broken'));
  const report = await runDoctor({}, f.context);
  assert.ok(report.checks.some((c) => c.name === '.env' && c.status === 'warn'));
  assert.ok(report.checks.some((c) => c.name === 'skill:hub:broken' && c.status === 'warn'));
  assert.equal(report.results.length, 0);
});

test('invalid registry or options fail before starting a process', async (t) => {
  const f = await fixture(t);
  for (const options of [
    { timeout: NaN },
    { timeout: 121 },
    { timeout: 0 },
    { concurrency: 5 },
    { client: 'unknown' },
    { name: 'unknown' },
  ])
    await assert.rejects(runDoctor(options, f.context));
  await fs.writeFile(f.registry, `bad: [ ${secret}`);
  await assert.rejects(runDoctor({}, f.context), (e) => !e.message.includes(secret));
  await assert.rejects(fs.access(path.join(f.root, 'demo-pids.log')));
});

test('CLI emits one JSON report without raw logs and returns failure for an unhealthy server', async (t) => {
  const f = await fixture(t, { auth: 'auth' });
  let result;
  try {
    execFileSync(process.execPath, [cli, 'doctor', 'auth', '--timeout', '4', '--json'], {
      env: { ...process.env, AGENT_HUB_HOME: f.root },
      encoding: 'utf8',
      stdio: 'pipe',
    });
  } catch (e) {
    result = e;
  }
  assert.equal(result.status, 1);
  assert.equal(JSON.parse(result.stdout).results[0].error.kind, 'auth');
  assert.ok(!result.stdout.includes(secret));
  assert.ok(!result.stderr.includes(secret));
});

test('HTTP checks return a polling job, reject concurrent checks and support cancellation', async (t) => {
  const f = await fixture(t, { hang: 'hang' });
  const ui = await startUiServer({
    port: 0,
    services: {
      state: async () => ({}),
      doctor: (opts, _, control) => runDoctor(opts, f.context, control),
    },
  });
  t.after(() => ui.close());
  const token = (await (await fetch(ui.url + '/api/state')).json()).token;
  const post = (route, body, authenticated = true) =>
    fetch(`${ui.url}/api/doctor/${route}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Agent-Hub-Token': authenticated ? token : '',
      },
      body: JSON.stringify(body),
    });
  assert.equal((await post('run', {}, false)).status, 403);
  assert.equal((await post('run', { timeout: 'bad' })).status, 400);
  const started = await post('run', { timeout: 6 });
  assert.equal(started.status, 202);
  const job = await started.json();
  assert.equal(job.state, 'running');
  assert.equal((await post('run', {})).status, 409);
  assert.equal((await post('cancel', { id: job.id })).status, 200);
  const final = await until(async () => {
    const status = await (await fetch(`${ui.url}/api/doctor/${job.id}`)).json();
    return status.state === 'done' ? status : null;
  });
  assert.equal(final.report.summary.cancelled, 1);
  assert.ok(!JSON.stringify(final).includes(secret));
});
