import path from 'node:path';
import { adapters } from '../../../adapters/index.js';
import { type ClientId } from '../../../contracts/clients.js';
import { inspectArtifact } from '../../../shared/artifacts.js';
import { clientPaths } from '../../../shared/paths.js';
import type { SetupOptions } from './types.js';

import type { ClientAdapter } from '../../../contracts/clients.js';
import type { ContentClient } from '../../configuration/content-context.js';

interface GuardInputs {
  root: string;
  scope: SetupOptions['scope'];
  automation: boolean;
  clients: ContentClient[];
  sources: ClientAdapter[];
  workspace: string | null;
  ids: ClientId[];
  native: { path: string }[];
}

export async function setupGuards({
  root,
  scope,
  automation,
  clients,
  sources,
  workspace,
  ids,
  native,
}: GuardInputs) {
  const files = (
    scope === 'hub'
      ? [
          'hub.yaml',
          '.env',
          '.gitignore',
          'mcp/servers.yaml',
          'skills',
          'instructions',
          'memory/MEMORY.md',
          'state/imported-definitions.json',
          'state/sync.json',
          'state/skills.json',
          'state/context.json',
        ]
      : ['hub.yaml', 'memory', 'state/repositories.json', 'templates/repo']
  ).map((file) => path.join(root, file));
  if (scope === 'hub') {
    for (const client of clients)
      files.push(client.skills, ...client.additionalSkills, client.instructions);
    const detected = await Promise.all(sources.map((source) => source.detect()));
    files.push(
      ...detected.flatMap((entry) =>
        Object.values(entry.paths).filter((file) =>
          ['.json', '.toml', '.yaml', '.yml'].includes(path.extname(file)),
        ),
      ),
    );
  } else if (automation && ids.includes('dsh')) {
    const dsh = await adapters.find((adapter) => adapter.id === 'dsh')!.detect();
    if (dsh.paths.profilePatch) files.push(dsh.paths.profilePatch);
  }
  if (automation && workspace) {
    if (ids.includes('claude-code'))
      files.push(path.join(clientPaths.claudeHome(), 'settings.json'));
    if (ids.includes('codex')) files.push(path.join(clientPaths.codexHome(), 'hooks.json'));
    if (ids.includes('dsh'))
      files.push(path.join(clientPaths.dshHome(), 'hooks', 'agent-hub-memory.json'));
  }
  if (workspace)
    files.push(
      ...['AGENTS.md', 'CLAUDE.md', '.agents/state/PROJECT.md', '.agents/state/NOW.md'].map(
        (file) => path.join(workspace!, file),
      ),
    );
  files.push(...native.map((source) => source.path));
  const guards = await Promise.all([...new Set(files)].sort().map((file) => inspectArtifact(file)));

  return guards;
}
