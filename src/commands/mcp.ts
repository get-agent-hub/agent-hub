import { spawn } from 'node:child_process';
import { readEnvFile } from '../core/configuration/env.js';
import { envPath, inferTransport, readRegistry } from '../core/configuration/registry.js';
import { c, printJson, table } from '../shared/output.js';

import { buildLaunch } from '../core/mcp/launch.js';
const REF = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

/** stderr only — stdout belongs to the MCP JSON-RPC stream. */
const log = (msg: string) => process.stderr.write(`ahub mcp: ${msg}\n`);

export async function mcpLsCommand(opts: { json?: boolean }): Promise<void> {
  const reg = await readRegistry();
  const rows = Object.entries(reg.servers).map(([name, s]) => ({
    name,
    transport: inferTransport(s),
    target: s.command ? [s.command, ...(s.args ?? [])].join(' ') : (s.url ?? ''),
    secrets: [...JSON.stringify(s).matchAll(REF)].map((m) => m[1]),
    only: s.only,
  }));
  if (opts.json) return printJson(rows);
  console.log(
    table(
      ['name', 'transport', 'target', 'secrets (.env)', 'only'],
      rows.map((r) => [
        r.name,
        r.transport,
        c.dim(r.target.slice(0, 70)),
        r.secrets.join(', ') || c.dim('—'),
        r.only?.join(',') ?? '',
      ]),
    ),
  );
}

export async function mcpRunCommand(name: string): Promise<void> {
  const reg = await readRegistry();
  const s = reg.servers[name];
  if (!s) {
    log(`unknown server "${name}" (known: ${Object.keys(reg.servers).join(', ') || 'none'})`);
    process.exit(1);
  }
  const launch = buildLaunch(s, await readEnvFile(envPath()));
  if (launch.missing.size) {
    log(
      `missing env var(s) for ${name}: ${[...launch.missing].join(', ')} — add them to ~/.agent-hub/.env`,
    );
    process.exit(1);
  }

  const child = spawn(launch.command, launch.args, {
    cwd: launch.cwd,
    env: { ...process.env, ...launch.env },
    stdio: 'inherit',
  });
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const)
    process.on(sig, () => child.kill(sig));
  child.on('error', (e) => {
    log(`failed to start ${name}: ${e.message}`);
    process.exit(127);
  });
  child.on('exit', (code, signal) => process.exit(code ?? (signal ? 128 : 1)));
}
