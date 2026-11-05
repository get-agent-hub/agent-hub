import path from 'node:path';
import { stringify } from 'yaml';
import type { ClientId } from '../../contracts/clients.js';
import { inspectArtifact } from '../../shared/artifacts.js';
import { readOptionalText } from '../../shared/file-store.js';
import { serializeRegistry } from '../configuration/registry.js';
import { managedPlan, type ArtifactRequest, type ManagedRow } from '../recovery/managed-plan.js';

/** The quick path deliberately creates no Git repository or remote. */
export async function planQuickInit(root: string, clients: ClientId[]) {
  const defaults: Record<string, string> = {
    'hub.yaml': stringify({
      version: 1,
      clients: Object.fromEntries(clients.map((id) => [id, { enabled: true }])),
    }),
    '.env': '# agent-hub secrets — git-ignored. KEY=value\n',
    'mcp/servers.yaml': serializeRegistry({ version: 1, servers: {} }),
  };
  const requests: ArtifactRequest[] = [];
  const rows: ManagedRow[] = [];
  for (const [name, content] of Object.entries(defaults)) {
    const before = await inspectArtifact(path.join(root, name));
    rows.push({
      path: before.path,
      client: 'hub',
      name,
      action: before.kind === 'missing' ? 'add' : 'keep',
    });
    if (before.kind === 'missing')
      requests.push({ before, client: 'hub', value: { kind: 'file', content, mode: 0o600 } });
  }
  const before = await inspectArtifact(path.join(root, '.gitignore'));
  const existing = (await readOptionalText(before.path)) ?? '';
  const missing = [
    '.env',
    '.env.*',
    'backups/',
    'legacy/',
    'state/',
    '*.log',
    '*.tmp',
    '.DS_Store',
  ].filter((line) => !existing.split(/\r?\n/).includes(line));
  if (missing.length) {
    requests.push({
      before,
      client: 'hub',
      value: {
        kind: 'file',
        content: `${existing}${existing && !existing.endsWith('\n') ? '\n' : ''}${missing.join('\n')}\n`,
        mode: before.mode || 0o600,
      },
    });
    rows.push({
      path: before.path,
      client: 'hub',
      name: '.gitignore',
      action: before.kind === 'missing' ? 'add' : 'replace',
    });
  }
  return managedPlan({ root, rows, requests, sources: [], command: ['quick'] });
}
