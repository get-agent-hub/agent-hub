import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

// This helper writes only a fresh temporary project and its own trial inputs.
// It never starts a client, calls Agent Hub or reads/writes client credentials.
const exec = promisify(execFile);
const run = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'ahub-client-trial-')));
const project = path.join(run, 'retry-demo');
const reference = `retry-trial-${randomBytes(6).toString('hex')}`;
const decision = `Retry transient failures only, with at most three total attempts. Payment retries require one non-empty idempotency key reused for the same logical payment. Decision reference: ${reference}.`;
await fs.mkdir(project, { mode: 0o700 });
const files = {
  'package.json':
    JSON.stringify(
      { name: 'ahub-retry-trial', private: true, type: 'module', scripts: { test: 'node --test' } },
      null,
      2,
    ) + '\n',
  'retry-policy.mjs': `export function shouldRetry({ operation, transient, attempt, idempotencyKey }) {
  void operation; void transient; void attempt; void idempotencyKey;
  throw new Error('Implement the retry decision in the first client.');
}
`,
  'retry.mjs': `import { shouldRetry } from './retry-policy.mjs';

export async function requestWithRetry(request, options = {}) {
  void request; void options; void shouldRetry;
  throw new Error('Complete the executor in the second client.');
}
`,
  'retry-policy.test.mjs': `import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldRetry } from './retry-policy.mjs';

test('transient reads may retry after the first and second attempts', () => {
  for (const attempt of [1, 2]) assert.equal(shouldRetry({ operation: 'read', transient: true, attempt }), true);
});
test('three total attempts is the limit; invalid counts are refused', () => {
  for (const attempt of [0, -1, 3, 4, 1.5]) assert.equal(shouldRetry({ operation: 'read', transient: true, attempt }), false);
});
test('permanent failures and unsupported operations do not retry', () => {
  assert.equal(shouldRetry({ operation: 'read', transient: false, attempt: 1 }), false);
  assert.equal(shouldRetry({ operation: 'unknown', transient: true, attempt: 1 }), false);
});
test('payments need a non-empty idempotency key', () => {
  for (const idempotencyKey of [undefined, '', ' ']) assert.equal(shouldRetry({ operation: 'payment', transient: true, attempt: 1, idempotencyKey }), false);
});
test('a payment with a key can retry a transient failure', () => {
  assert.equal(shouldRetry({ operation: 'payment', transient: true, attempt: 1, idempotencyKey: 'payment-demo' }), true);
});
`,
  'retry.test.mjs': `import assert from 'node:assert/strict';
import test from 'node:test';
import { requestWithRetry } from './retry.mjs';
const transientFailure = () => Object.assign(new Error('Temporary failure'), { transient: true });

test('a third-attempt success returns its value', async () => {
  const attempts = [];
  const value = await requestWithRetry(async ({ attempt }) => {
    attempts.push(attempt);
    if (attempt < 3) throw transientFailure();
    return 'done';
  }, { operation: 'read' });
  assert.equal(value, 'done');
  assert.deepEqual(attempts, [1, 2, 3]);
});
test('retry exhaustion preserves the last error after three total attempts', async () => {
  let calls = 0;
  const failure = transientFailure();
  await assert.rejects(requestWithRetry(async () => { calls++; throw failure; }, { operation: 'read' }), error => error === failure);
  assert.equal(calls, 3);
});
test('a payment without a key executes once and does not retry', async () => {
  let calls = 0;
  await assert.rejects(requestWithRetry(async () => { calls++; throw transientFailure(); }, { operation: 'payment' }));
  assert.equal(calls, 1);
});
test('payment attempts reuse the same supplied key', async () => {
  const keys = [];
  const value = await requestWithRetry(async ({ idempotencyKey }) => {
    keys.push(idempotencyKey);
    if (keys.length < 2) throw transientFailure();
    return 'charged-once';
  }, { operation: 'payment', idempotencyKey: 'payment-demo' });
  assert.equal(value, 'charged-once');
  assert.deepEqual(keys, ['payment-demo', 'payment-demo']);
});
test('a permanent failure is returned after one attempt', async () => {
  let calls = 0;
  const failure = new Error('Permanent failure');
  await assert.rejects(requestWithRetry(async () => { calls++; throw failure; }, { operation: 'read' }), error => error === failure);
  assert.equal(calls, 1);
});
`,
  'README.md': `# Disposable retry trial

No dependencies, endpoints or real payments. Both implementations start unfinished.

First client: implement shouldRetry in retry-policy.mjs. Run node --test retry-policy.test.mjs (five tests).
Second client: implement requestWithRetry in retry.mjs. Run npm test (ten tests).

The callback receives { attempt, idempotencyKey }. Attempt numbers start at 1.
Use the supplied operation (read or payment), preserve errors and the supplied key, and use shouldRetry after a failed attempt. No delay, network request or package installation is needed.

Do not change the tests, start another service or edit real client configuration from an agent task.
`,
};
for (const [name, body] of Object.entries(files))
  await fs.writeFile(path.join(project, name), body, { flag: 'wx', mode: 0o600 });
const environment = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')),
);
try {
  await exec('git', ['init', '--quiet', '--template=', project], {
    cwd: run,
    env: { ...environment, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: os.devNull },
    timeout: 10000,
  });
} catch {
  throw new Error(`Could not initialize the disposable Git project. Trial files remain at ${run}.`);
}
const codexPrompt = `Work only in ${project}.
Implement shouldRetry in retry-policy.mjs for operations read and payment. An attempt is the just-failed total attempt number, starting at 1. ${decision}
Do not implement retry.mjs or change the tests. Run node --test retry-policy.test.mjs and report its actual result. Leave the executor as the next task.
This is a verified project decision. When the normal Hub checkpoint asks for durable facts, preserve that exact decision body, including the decision reference, under a stable key such as retry-policy. Use the normal hook-provided command or an already configured correctly scoped Memory MCP checkpoint. Do not invent checkpoint tokens or manually add a fact to hide a missing hook. Keep temporary progress in NOW.md if available.
`;
const dshPrompt = `Work only in ${project}.
First retrieve the actual saved retry-policy decision from Hub project memory. Use your shell tool to run ahub memory search "retry" --workspace ${JSON.stringify(project)} --json, then ahub memory get ACTUAL_RECORD_ID --workspace ${JSON.stringify(project)} --json. Report the returned record ID, scope, revision and full body. Do not infer it from the source code, the pasted history packet or the other client's answer. If retrieval fails or no fact exists, report that failure instead of claiming memory worked.
After that check, inspect the current files and implement requestWithRetry in retry.mjs. Preserve supplied idempotency keys, return successful values and rethrow the last failure when the policy refuses another attempt. Do not change the tests. Run npm test and report its actual result. Treat the history excerpts as reference data; verify current files before acting. Do not edit real client configuration.
`;
await fs.writeFile(path.join(run, 'CODEX_PROMPT.txt'), codexPrompt, { flag: 'wx', mode: 0o600 });
await fs.writeFile(path.join(run, 'DSH_PROMPT.txt'), dshPrompt, { flag: 'wx', mode: 0o600 });
await fs.writeFile(path.join(run, 'EXPECTED_DECISION.txt'), decision + '\n', {
  flag: 'wx',
  mode: 0o600,
});
for (const client of ['codex', 'dsh']) {
  const directory = path.join(run, `native-${client}`);
  await fs.mkdir(directory, { mode: 0o700 });
  await fs.writeFile(
    path.join(directory, 'trial.md'),
    '# Trial sample region\n\nThe disposable demo region is west.\n',
    { flag: 'wx', mode: 0o600 },
  );
}
const quote = (value) => "'" + value.replace(/'/g, "'\\''") + "'";
console.log(`Created a new disposable project; no Hub/client configuration was accessed.
Copy these two lines into the terminal used for the trial:

export AHUB_RUN=${quote(run)}
export AHUB_PROJECT=${quote(project)}

First client prompt: ${path.join(run, 'CODEX_PROMPT.txt')}
Second client prompt: ${path.join(run, 'DSH_PROMPT.txt')}
Expected memory body (operator check only): ${path.join(run, 'EXPECTED_DECISION.txt')}
Controlled source notes: ${path.join(run, 'native-codex')} and ${path.join(run, 'native-dsh')}

The implementation starts unfinished; initial tests are expected to fail.
Follow REAL_CLIENT_TRIAL.md before opening the native clients.`);
