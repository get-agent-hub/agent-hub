import path from 'node:path';
import { adapters } from '../adapters/index.js';
import { clientPaths, hubRoot } from './paths.js';
import type { ClientId } from './types.js';

export interface ContentClient {
  id: ClientId;
  label: string;
  installed: boolean;
  skills: string;
  additionalSkills: string[];
  instructions: string;
}
export interface ContentContext {
  root: string;
  clients: ContentClient[];
}

export async function defaultContentContext(): Promise<ContentContext> {
  const clients = await Promise.all(
    adapters.map(async (adapter) => {
      const detection = await adapter.detect();
      const home =
        adapter.id === 'claude-code'
          ? clientPaths.claudeHome()
          : adapter.id === 'codex'
            ? clientPaths.codexHome()
            : clientPaths.dshHome();
      return {
        id: adapter.id,
        label: adapter.label,
        installed: detection.installed,
        skills: path.resolve(
          adapter.id === 'claude-code'
            ? path.join(home, 'skills')
            : adapter.id === 'dsh'
              ? clientPaths.dshSkills()
              : clientPaths.agentsSkills(),
        ),
        additionalSkills: adapter.id === 'claude-code' ? [] : [path.resolve(home, 'skills')],
        instructions: path.resolve(home, adapter.id === 'claude-code' ? 'CLAUDE.md' : 'AGENTS.md'),
      };
    }),
  );
  return { root: hubRoot(), clients };
}
