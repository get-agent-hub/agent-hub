import { spawn } from 'node:child_process';
import { readEnvFile } from '../core/env.js';
import { c, printJson, table } from '../core/output.js';
import { expandHome } from '../core/paths.js';
import { envPath, inferTransport, readRegistry, type HubServer } from '../core/registry.js';

const MCP_REMOTE = 'mcp-remote@0.15.2';
const PROXY_VARS = ['HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'no_proxy'];
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
      rows.map((r) => [r.name, r.transport, c.dim(r.target.slice(0, 70)), r.secrets.join(', ') || c.dim('—'), r.only?.join(',') ?? '']),
    ),
  );
}

function resolver(vars: Map<string, string>) {
  const missing = new Set<string>();
  const sub = (s: string) =>
    s.replace(REF, (_, k: string) => {
      const v = vars.get(k) ?? process.env[k];
      if (v === undefined) missing.add(k);
      return v ?? '';
    });
  return { sub, missing };
}

/** Build the concrete process to spawn for a server. Exported for tests / sync previews. */
export function buildLaunch(s: HubServer, hubEnv: Map<string, string>) {
  const { sub, missing } = resolver(hubEnv);
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(s.env ?? {})) env[k] = sub(v);
  if (s.proxy) for (const k of PROXY_VARS) if (hubEnv.has(k)) env[k] = hubEnv.get(k)!;

  const transport = inferTransport(s);
  if (transport === 'stdio') {
    if (!s.command) throw new Error('stdio server without command');
    return {
      command: expandHome(sub(s.command)),
      args: (s.args ?? []).map(sub),
      cwd: s.cwd ? expandHome(sub(s.cwd)) : undefined,
      env,
      missing,
    };
  }

  // Remote server → local stdio via mcp-remote. Header secrets are passed as env and
  // referenced as ${VAR} so they never appear in the process list.
  if (!s.url) throw new Error(`${transport} server without url`);
  const args = ['-y', MCP_REMOTE, sub(s.url), '--transport', transport === 'sse' ? 'sse-only' : 'http-only'];
  for (const [k, v] of Object.entries(s.headers ?? {})) {
    for (const m of v.matchAll(REF)) env[m[1]] = sub(m[0]);
    args.push('--header', `${k}:${v}`);
  }
  if (s.proxy) args.push('--enable-proxy');
  return { command: 'npx', args, cwd: undefined, env, missing };
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
    log(`missing env var(s) for ${name}: ${[...launch.missing].join(', ')} — add them to ~/.agent-hub/.env`);
    process.exit(1);
  }

  const child = spawn(launch.command, launch.args, {
    cwd: launch.cwd,
    env: { ...process.env, ...launch.env },
    stdio: 'inherit',
  });
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.on(sig, () => child.kill(sig));
  child.on('error', (e) => {
    log(`failed to start ${name}: ${e.message}`);
    process.exit(127);
  });
  child.on('exit', (code, signal) => process.exit(code ?? (signal ? 128 : 1)));
}
