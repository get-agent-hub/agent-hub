import readline from 'node:readline';
import fs from 'node:fs';
import { spawn } from 'node:child_process';

const mode = process.env.FIXTURE_MODE || 'healthy';
const record = (file, value) => {
  if (file) fs.appendFileSync(file, `${value}\n`);
};
record(process.env.FIXTURE_PIDS, process.pid);
if (mode === 'hang') {
  process.on('SIGTERM', () => {});
  const child = spawn(
    process.execPath,
    ['-e', 'process.on("SIGTERM",()=>{}); setInterval(()=>{},1000)'],
    { stdio: 'ignore' },
  );
  record(process.env.FIXTURE_PIDS, child.pid);
}
let page = 0;
let initialized = false;
function reply(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
}
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  const message = JSON.parse(line);
  record(process.env.FIXTURE_METHODS, message.method);
  if (mode === 'hang') return;
  if (message.method === 'initialize') {
    if (mode === 'package-cache') {
      process.stderr.write(
        `npm error ENOTEMPTY: directory not empty, rename '/private/node_modules/n8n-mcp' ${process.env.API_TOKEN}\n`,
      );
      process.exit(66);
    }
    if (mode === 'unavailable') {
      process.stdout.write(
        JSON.stringify({
          jsonrpc: '2.0',
          id: message.id,
          error: { code: -32000, message: `HTTP 503 Service Unavailable ${process.env.API_TOKEN}` },
        }) + '\n',
      );
      return;
    }
    if (mode === 'malformed') {
      process.stdout.write(`not-json ${process.env.API_TOKEN}\n`);
      return;
    }
    if (mode === 'auth') {
      process.stderr.write(`Authorization: Bearer ${process.env.API_TOKEN}\n`);
      process.stdout.write(
        JSON.stringify({
          jsonrpc: '2.0',
          id: message.id,
          error: { code: -32000, message: `401 Unauthorized ${process.env.API_TOKEN}` },
        }) + '\n',
      );
      return;
    }
    if (mode === 'network') {
      process.stderr.write(
        `ECONNREFUSED https://private.invalid/?token=${process.env.API_TOKEN}\n`,
      );
      process.exit(7);
    }
    reply(message.id, {
      protocolVersion: message.params.protocolVersion,
      capabilities: mode === 'resources' ? { resources: {} } : { tools: {} },
      serverInfo: { name: 'fixture', version: '1.0' },
    });
  } else if (message.method === 'notifications/initialized') initialized = true;
  else if (message.method === 'tools/list') {
    if (!initialized) throw new Error('tools/list before initialized notification');
    if (mode === 'tools-hang') return;
    const tool = (name) => ({ name, inputSchema: { type: 'object' } });
    if (mode === 'loop')
      reply(message.id, { tools: [tool(`page-${page++}`)], nextCursor: 'again' });
    else if (mode === 'empty') reply(message.id, { tools: [] });
    else if (!message.params?.cursor)
      reply(message.id, { tools: [tool('first'), tool('second')], nextCursor: 'page2' });
    else reply(message.id, { tools: [tool('third')] });
  } else if (message.method === 'ping') reply(message.id, {});
  else if (message.method === 'tools/call') throw new Error('Doctor must never call tools');
});
setInterval(() => {}, 1000);
