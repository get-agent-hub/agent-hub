import path from 'node:path';
import type { ClientAdapter, ClientSnapshot, DetectResult, RawMcp } from '../contracts/clients.js';
import { readDefinitions } from '../core/mcp/config-edit.js';
import { toMcpEntry } from '../core/mcp/mcp.js';
import { exists, listSkills, readText } from '../shared/fs.js';
import { clientPaths } from '../shared/paths.js';
import { claudeSessions } from './claude-sessions.js';
import { reservedSkill } from './policies.js';

export const claudeAdapter: ClientAdapter = {
  id: 'claude-code',
  label: 'Claude Code',

  discoverSessions: (control) => claudeSessions(clientPaths.claudeHome(), undefined, control),

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
    return [...readDefinitions('claude-code', (await readText(cfgPath)) ?? null)].map(
      ([name, raw]) => ({ name, raw, source: cfgPath }),
    );
  },

  async read(): Promise<ClientSnapshot> {
    const mcp = (await this.readMcpRaw()).map((r) => toMcpEntry(r.name, r.raw, r.source));
    const skills = (await listSkills(path.join(clientPaths.claudeHome(), 'skills'))).filter(
      (skill) => !reservedSkill('claude-code', skill.name),
    );
    return { client: 'claude-code', skills, mcp };
  },
};
