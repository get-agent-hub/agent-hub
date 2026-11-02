import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
import { classifyFailure, failure, type DoctorPhase, type ProbeResult } from './doctor-types.js';

const name = process.argv[2];
const timeoutMs = Number(process.argv[3]);
let reported = false;
let phase: DoctorPhase = 'initialize';
let stderr = '';
const client = new Client({ name: 'agent-hub-doctor', version: '0.1.0' }, { capabilities: {} });
const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined));
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [fileURLToPath(new URL('../../dist/cli.js', import.meta.url)), 'mcp', 'run', name],
  env, stderr: 'pipe', maxBufferSize: 4 * 1024 * 1024,
});
transport.stderr?.on('data', (chunk: Buffer) => { stderr = (stderr + chunk.toString('utf8')).slice(-8192); });

function report(result: ProbeResult) {
  if (reported) return;
  reported = true;
  process.send?.(result);
}

client.onerror = (error) => report({ status: 'failed', phase, tools: null, error: classifyFailure(error, stderr) });
// A killed doctor must not leave its launcher or the server running.
process.on('disconnect', () => {
  if (process.platform !== 'win32') { try { process.kill(-process.pid, 'SIGTERM'); } catch { /* group already exited */ } }
  process.exit(0);
});

try {
  if (!name || !Number.isFinite(timeoutMs)) throw new Error('Invalid worker configuration');
  const deadline = Date.now() + timeoutMs;
  const requestOptions = () => ({ timeout: Math.max(1, deadline - Date.now()), resetTimeoutOnProgress: false });
  await client.connect(transport, requestOptions());
  if (!client.getServerCapabilities()?.tools) {
    report({ status: 'ok', phase: 'initialize', tools: null, note: 'Connected; this server does not advertise tools.' });
  } else {
    phase = 'tools/list';
    process.send?.({ event: 'phase', phase });
    let cursor: string | undefined;
    const cursors = new Set<string>();
    const names = new Set<string>();
    let pages = 0;
    do {
      const page = await client.listTools(cursor ? { cursor } : undefined, requestOptions());
      pages++;
      for (const tool of page.tools) {
        if (names.has(tool.name)) throw new Error('Invalid duplicate tool response');
        names.add(tool.name);
      }
      cursor = page.nextCursor;
      if (pages > 100 || names.size > 10000 || (cursor && cursors.has(cursor))) throw new Error('Invalid pagination response');
      if (cursor) cursors.add(cursor);
    } while (cursor);
    report({ status: 'ok', phase, tools: names.size, pages });
  }
} catch (error) {
  report({ status: 'failed', phase, tools: null, error: classifyFailure(error, stderr) });
} finally {
  if (!reported) report({ status: 'failed', phase, tools: null, error: failure('process-exit') });
  await client.close().catch(() => undefined);
  process.disconnect?.();
}
