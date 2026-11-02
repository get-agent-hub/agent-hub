import crypto from 'node:crypto';
import type { McpEntry, McpTransport } from './types.js';

const SECRET_KEY = /(api[_-]?key|token|secret|password|passwd|authorization|bearer|cookie|credential)/i;
const ENV_REF = /^\$\{?[A-Za-z_][A-Za-z0-9_]*\}?$/;

export function isSecretKey(key: string): boolean {
  return SECRET_KEY.test(key);
}

/** A value is an inline secret if its key looks secret and the value is a literal, not an env reference. */
export function isInlineSecret(key: string, value: unknown): boolean {
  return isSecretKey(key) && typeof value === 'string' && value.length > 0 && !ENV_REF.test(value);
}

function stableStringify(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v);
}

/** Keys that are client-specific noise and must not affect drift comparison. */
const IGNORED = new Set(['type', 'transport', 'enabled', 'tools', 'startup_timeout_sec', 'tool_timeout_sec']);

export function fingerprint(cfg: Record<string, unknown>): string {
  const norm: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(cfg)) if (!IGNORED.has(k)) norm[k] = v;
  // drop empty env objects so {env:{}} == no env
  if (norm.env && typeof norm.env === 'object' && Object.keys(norm.env as object).length === 0) delete norm.env;
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
