import crypto from 'node:crypto';
import { isInlineSecret } from './secrets.js';
import type { McpEntry, McpTransport } from './types.js';

import { stableStringify } from './values.js';
export { stableStringify } from './values.js';

/** Keys that are client-specific noise and must not affect drift comparison. */
const IGNORED = new Set([
  'type',
  'transport',
  'enabled',
  'tools',
  'startup_timeout_sec',
  'tool_timeout_sec',
]);

export function fingerprint(cfg: Record<string, unknown>): string {
  const norm: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(cfg)) if (!IGNORED.has(k)) norm[k] = v;
  // drop empty env objects so {env:{}} == no env
  if (norm.env && typeof norm.env === 'object' && Object.keys(norm.env as object).length === 0)
    delete norm.env;
  return crypto.createHash('sha256').update(stableStringify(norm)).digest('hex').slice(0, 12);
}

/** Normalize a raw client MCP definition (Claude JSON / Codex TOML / DSH YAML shapes). */
export function toMcpEntry(name: string, raw: Record<string, unknown>, source: string): McpEntry {
  const env = (raw.env ?? {}) as Record<string, unknown>;
  const headers = (raw.headers ?? raw.http_headers ?? {}) as Record<string, unknown>;
  const url = (raw.url ?? raw.serverUrl) as string | undefined;
  const declared = String(raw.type ?? raw.transport ?? '').toLowerCase();
  let transport: McpTransport = 'unknown';
  if (declared === 'stdio' || raw.command) transport = 'stdio';
  else if (declared === 'sse') transport = 'sse';
  else if (declared.includes('http') || url) transport = 'http';

  const hasInlineSecret =
    Object.entries(env).some(([k, v]) => isInlineSecret(k, v)) ||
    Object.entries(headers).some(([k, v]) => isInlineSecret(k, v));

  return {
    name,
    transport,
    command: raw.command as string | undefined,
    args: raw.args as string[] | undefined,
    url,
    envNames: Object.keys(env),
    hasInlineSecret,
    fingerprint: fingerprint(raw),
    source,
  };
}
