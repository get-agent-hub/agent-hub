import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import https from 'node:https';
import { execFileSync, spawn } from 'node:child_process';
import test from 'node:test';
import {
  readTelemetry,
  setTelemetry,
  telemetryIdentity,
  telemetryStatus,
} from '../dist/core/telemetry/settings.js';
import { recordUsage, sendUsage } from '../dist/core/telemetry/usage.js';
import { startUiServer } from '../dist/ui/server.js';

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ahub-metrics-'));
  const keys = [
    'AGENT_HUB_TELEMETRY_STATE',
    'AGENT_HUB_TELEMETRY_URL',
    'AGENT_HUB_TELEMETRY_DISABLED',
    'DO_NOT_TRACK',
    'CI',
    'NODE_TEST_CONTEXT',
    'NODE_EXTRA_CA_CERTS',
    'AGENT_HUB_HOME',
  ];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  keys.forEach((key) => delete process.env[key]);
  const file = path.join(root, 'preferences', 'telemetry.json');
  process.env.AGENT_HUB_TELEMETRY_STATE = file;
  process.env.AGENT_HUB_TELEMETRY_URL = 'https://collector.example/v1/events';
  process.env.AGENT_HUB_HOME = path.join(root, 'hub');
  t.after(async () => {
    for (const key of keys)
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    await fs.rm(root, { recursive: true, force: true });
  });
  return { root, file };
}
const exists = async (file) =>
  fs.stat(file).then(
    () => true,
    () => false,
  );

test('default collection has no identity until a real action; opt-out survives Hub deletion and re-enable rotates identity', async (t) => {
  const f = await fixture(t);
  assert.equal((await telemetryStatus()).enabled, true);
  assert.equal(await exists(f.file), false);
  const id = await telemetryIdentity();
  assert.match(id, /^[0-9a-f-]{36}$/);
  assert.equal(await telemetryIdentity(), id);
  assert.equal((await fs.stat(f.file)).mode & 0o777, 0o600);
  await setTelemetry(false);
  assert.deepEqual(await readTelemetry(), { version: 1, enabled: false });
  await fs.rm(path.join(f.root, 'hub'), { recursive: true, force: true });
  assert.equal(await telemetryIdentity(), null);
  await setTelemetry(true);
  assert.notEqual(await telemetryIdentity(), id);
});

test('environment overrides and corrupt, oversized or symlink preferences fail closed', async (t) => {
  const f = await fixture(t);
  for (const key of ['DO_NOT_TRACK', 'AGENT_HUB_TELEMETRY_DISABLED', 'CI', 'NODE_TEST_CONTEXT']) {
    process.env[key] = '1';
    assert.equal(await telemetryIdentity(), null);
    assert.equal(await exists(f.file), false);
    delete process.env[key];
  }
  await fs.mkdir(path.dirname(f.file), { recursive: true });
  for (const text of [
    'broken',
    '{"version":2,"enabled":true}',
    'x'.repeat(1025),
    '{"version":1,"enabled":true,"id":"not-a-uuid"}',
  ]) {
    await fs.writeFile(f.file, text);
    assert.equal(await telemetryIdentity(), null);
    assert.equal(await fs.readFile(f.file, 'utf8'), text);
  }
  await setTelemetry(false); // A broken preference can still be disabled explicitly.
  await fs.unlink(f.file);
  const target = path.join(f.root, 'private.txt');
  await fs.writeFile(target, 'do not replace');
  await fs.symlink(target, f.file);
  assert.equal(await telemetryIdentity(), null);
  await assert.rejects(setTelemetry(true), /Could not save analytics/);
  assert.equal(await fs.readFile(target, 'utf8'), 'do not replace');
});

test('busy preference writes drop metrics; invalid destinations do not create identifiers', async (t) => {
  const f = await fixture(t);
  process.env.AGENT_HUB_TELEMETRY_URL = 'http://collector.example/v1/events';
  assert.equal(await telemetryIdentity(), null);
  assert.equal(await exists(f.file), false);
  for (const url of [
    'https://a:b@collector.example/v1/events',
    'https://collector.example/v1/events?private=x',
    'https://collector.example/v1/events#fragment',
    'https://collector.example/other',
  ]) {
    process.env.AGENT_HUB_TELEMETRY_URL = url;
    assert.equal((await telemetryStatus()).enabled, false);
  }
  process.env.AGENT_HUB_TELEMETRY_URL = 'https://collector.example/v1/events';
  await fs.mkdir(path.dirname(f.file), { recursive: true });
  await fs.writeFile(f.file + '.lock', '');
  assert.equal(await telemetryIdentity(), null);
  await assert.rejects(setTelemetry(false), /Could not save analytics/);
  await fs.unlink(f.file + '.lock');
  assert.ok(await telemetryIdentity());
});

test('sender accepts only named metadata, rejects stale identities and never backfills after opt-out', async (t) => {
  await fixture(t);
  const id = await telemetryIdentity();
  const calls = [];
  const transport = async (url, options) => {
    calls.push({ url, ...options });
    return new Response('', { status: 202 });
  };
  await sendUsage({ event: 'search_performed', id }, transport);
  assert.equal(calls.length, 1);
  const body = JSON.parse(calls[0].body);
  assert.deepEqual(
    Object.keys(body).sort(),
    ['enabled', 'surface', 'event', 'distinct_id', 'language', 'version'].sort(),
  );
  assert.equal(body.enabled, true);
  assert.equal(body.surface, 'product');
  assert.equal(body.event, 'search_performed');
  assert.deepEqual(calls[0].headers, { 'Content-Type': 'application/json' });
  assert.equal(calls[0].redirect, 'error');
  await sendUsage({ event: 'search_performed', id, query: 'private text' }, transport);
  await sendUsage({ event: 'not_an_event', id }, transport);
  await setTelemetry(false);
  await sendUsage({ event: 'chat_opened', id }, transport);
  await setTelemetry(true);
  await sendUsage({ event: 'chat_opened', id }, transport);
  assert.equal(calls.length, 1);
  const nextId = await telemetryIdentity();
  await sendUsage({ event: 'chat_opened', id: nextId }, async () => {
    throw new Error('private provider failure');
  });
  let aborted = false;
  await sendUsage({ event: 'chat_opened', id: nextId }, async (_url, options) => {
    // A real pending socket keeps Node 22 alive; the injected transport must do so too.
    await new Promise((resolve) => {
      const socket = setTimeout(resolve, 2000);
      options.signal.addEventListener(
        'abort',
        () => {
          aborted = true;
          clearTimeout(socket);
          resolve();
        },
        { once: true },
      );
    });
    throw new Error('Timeout');
  });
  assert.equal(aborted, true);
});

test('detached worker delivers to an isolated TLS collector and CLI opt-out prevents further traffic', async (t) => {
  const f = await fixture(t);
  const certificate = path.join(f.root, 'cert.pem');
  const privateKey = path.join(f.root, 'key.pem');
  execFileSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-days',
      '1',
      '-subj',
      '/CN=127.0.0.1',
      '-addext',
      'subjectAltName=IP:127.0.0.1',
      '-keyout',
      privateKey,
      '-out',
      certificate,
    ],
    { stdio: 'ignore' },
  );
  const bodies = [];
  const server = https.createServer(
    { key: await fs.readFile(privateKey), cert: await fs.readFile(certificate) },
    async (req, res) => {
      let body = '';
      for await (const part of req) body += part;
      bodies.push(JSON.parse(body));
      res.writeHead(202).end();
    },
  );
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(
    () =>
      new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections();
      }),
  );
  process.env.AGENT_HUB_TELEMETRY_URL = `https://127.0.0.1:${server.address().port}/v1/events`;
  process.env.NODE_EXTRA_CA_CERTS = certificate;
  recordUsage('context_exported');
  for (let attempt = 0; attempt < 150 && !bodies.length; attempt++)
    await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(bodies.length, 1);
  assert.equal(bodies[0].event, 'context_exported');
  const old = await telemetryIdentity();
  const run = (file, args = [], input = '') =>
    new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [file, ...args], {
        env: process.env,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      let output = '';
      child.stdout.on('data', (data) => {
        output += data;
      });
      child.on('error', reject);
      child.on('close', (code) =>
        code === 0 ? resolve(output) : reject(new Error('Isolated command failed')),
      );
      child.stdin.end(input);
    });
  const off = JSON.parse(await run('dist/cli.js', ['telemetry', 'off']));
  assert.equal(off.enabled, false);
  const output = await run(
    'dist/workers/telemetry.js',
    [],
    JSON.stringify({ event: 'chat_opened', id: old }),
  );
  assert.equal(output, '');
  assert.equal(bodies.length, 1);
  assert.deepEqual(await readTelemetry(), { version: 1, enabled: false });
});

test('HTTP settings are token/origin protected and available when unrelated client parsing fails', async (t) => {
  const f = await fixture(t);
  const ui = await startUiServer({
    port: 0,
    services: {
      state: async () => {
        throw new Error('private settings');
      },
    },
  });
  t.after(() => ui.close());
  const state = await (await fetch(ui.url + '/api/state')).json();
  assert.equal(state.telemetry.enabled, true);
  assert.equal(await exists(f.file), false);
  const post = (name, body, token = state.token, extra = {}) =>
    fetch(ui.url + '/api/telemetry/' + name, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Agent-Hub-Token': token, ...extra },
      body: JSON.stringify(body),
    });
  assert.equal((await post('settings', { enabled: false }, '')).status, 403);
  assert.equal(
    (
      await post('settings', { enabled: false }, state.token, {
        Origin: 'https://unrelated.example',
      })
    ).status,
    403,
  );
  assert.equal((await post('settings', { enabled: false, file: '/private' })).status, 400);
  assert.equal((await post('event', { event: 'chat_opened', chat: 'private-id' })).status, 400);
  assert.equal(
    (await post('event', { event: 'chat_opened' }, state.token, { DNT: '1' })).status,
    202,
  );
  assert.equal(await exists(f.file), false, 'DNT request creates no identifier or worker');
  assert.equal((await post('settings', { enabled: false })).status, 200);
  assert.equal((await (await post('status', {})).json()).enabled, false);
  assert.equal((await post('event', { event: 'app_opened' })).status, 202);
  assert.deepEqual(await readTelemetry(), { version: 1, enabled: false });
});
