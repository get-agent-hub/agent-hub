import type { ClientId } from '../core/types.js';

/** Client-local policy keys, never part of a shared MCP launch definition. */
export const CODEX_POLICY_KEYS = [
  'tools',
  'startup_timeout_sec',
  'tool_timeout_sec',
  'enabled',
  'enabled_tools',
  'disabled_tools',
  'env_vars',
  'required',
  'default_tools_approval_mode',
];

/** Application-bundled launchers are not portable to other agent clients. */
export function applicationOwner(server: { command?: unknown }): ClientId | undefined {
  return /[\\/](ChatGPT|Codex)\.app[\\/]/.test(String(server.command ?? '')) ? 'codex' : undefined;
}
export const appManaged = (server: { command?: unknown }): boolean =>
  applicationOwner(server) !== undefined;
