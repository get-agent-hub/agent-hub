export const CLIENT_IDS = ['claude-code', 'codex', 'dsh'] as const;
export type ClientId = (typeof CLIENT_IDS)[number];

export interface DetectResult {
  installed: boolean;
  /** Config files / dirs this adapter reads or writes. */
  paths: Record<string, string>;
  notes?: string[];
}

export interface SkillEntry {
  name: string;
  /** Path as seen by the client (may be a symlink). */
  path: string;
  /** Fully resolved real path. */
  realPath: string;
  hasSkillMd: boolean;
}

export type McpTransport = 'stdio' | 'http' | 'sse' | 'unknown';

export interface McpEntry {
  name: string;
  transport: McpTransport;
  command?: string;
  args?: string[];
  url?: string;
  /** Env var names only; values are never kept in snapshots. */
  envNames: string[];
  /** True if any env/header value looks like an inline secret. */
  hasInlineSecret: boolean;
  /** Stable hash of the normalized config (secrets included) for drift detection. */
  fingerprint: string;
  /** Where the entry was read from (file + scope). */
  source: string;
}

export interface ClientSnapshot {
  client: ClientId;
  skills: SkillEntry[];
  mcp: McpEntry[];
}

/** Raw client MCP definition. Contains secrets — never print or serialize to output. */
export interface RawMcp {
  name: string;
  raw: Record<string, unknown>;
  source: string;
}

export interface ClientAdapter {
  id: ClientId;
  label: string;
  detect(): Promise<DetectResult>;
  read(): Promise<ClientSnapshot>;
  /** Global-scope MCP definitions as stored by the client (secrets included). */
  readMcpRaw(): Promise<RawMcp[]>;
  /** Optional read-only metadata capability; never returns conversation bodies. */
  discoverSessions?(): Promise<SessionScan>;
}

export interface SessionScan {
  source: string;
  coverage: 'complete' | 'partial' | 'unavailable' | 'not-found';
  sessions: { id: string; locations: string[] }[];
  filesRead: number;
  bytesRead: number;
  issues: string[];
}

export interface HubState {
  root: string;
  exists: boolean;
  skills: SkillEntry[];
  mcp: McpEntry[];
}
