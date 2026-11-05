import { readDefinitions } from '../core/config-edit.js';
import path from 'node:path';
import { clientPaths } from '../core/paths.js';
import { exists, listSkills, readText } from '../core/fs.js';
import { toMcpEntry } from '../core/mcp.js';
import type { ClientAdapter, ClientSnapshot, DetectResult, RawMcp } from '../core/types.js';
import { reservedSkill } from './policies.js';
import { claudeSessions } from './claude-sessions.js';

export const claudeAdapter: ClientAdapter = {
  id: 'claude-code',
  label: 'Claude Code',

  discoverSessions: () => claudeSessions(clientPaths.claudeHome()),

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
