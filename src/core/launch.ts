import { expandHome } from './paths.js';
import { inferTransport, type HubServer } from './registry.js';

const MCP_REMOTE = 'mcp-remote@0.15.2';
const PROXY_VARS = [
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'NO_PROXY',
  'http_proxy',
  'https_proxy',
  'no_proxy',
];
const REF = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

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
  const args = [
    '-y',
    MCP_REMOTE,
    sub(s.url),
    '--transport',
    transport === 'sse' ? 'sse-only' : 'http-only',
  ];
  for (const [k, v] of Object.entries(s.headers ?? {})) {
    for (const m of v.matchAll(REF)) env[m[1]] = sub(m[0]);
    args.push('--header', `${k}:${v}`);
  }
  if (s.proxy) args.push('--enable-proxy');
  return { command: 'npx', args, cwd: undefined, env, missing };
}
