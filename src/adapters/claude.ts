import path from 'node:path';
import { clientPaths } from '../core/paths.js';
import { exists, listSkills, readJson } from '../core/fs.js';
import { toMcpEntry } from '../core/mcp.js';
import type { ClientAdapter, ClientSnapshot, DetectResult, RawMcp } from '../core/types.js';

type ClaudeJson = { mcpServers?: Record<string, Record<string, unknown>> };

export const claudeAdapter: ClientAdapter = {
  id: 'claude-code',
  label: 'Claude Code',

  async detect(): Promise<DetectResult> {
    const paths = {
      config: clientPaths.claudeJson(),
      home: clientPaths.claudeHome(),
      skills: path.join(clientPaths.claudeHome(), 'skills'),
    };
    return { installed: (await exists(paths.config)) || (await exists(paths.home)), paths };
  },

  async readMcpRaw(): Promise<RawMcp[]> {
    const cfgPath = clientPaths.claudeJson();
    const cfg = (await readJson<ClaudeJson>(cfgPath)) ?? {};
    return Object.entries(cfg.mcpServers ?? {}).map(([name, raw]) => ({ name, raw, source: `${cfgPath}#mcpServers` }));
  },

  async read(): Promise<ClientSnapshot> {
    const mcp = (await this.readMcpRaw()).map((r) => toMcpEntry(r.name, r.raw, r.source));
    const skills = await listSkills(path.join(clientPaths.claudeHome(), 'skills'));
    return { client: 'claude-code', skills, mcp };
  },
};
