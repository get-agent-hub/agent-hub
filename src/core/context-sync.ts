import fs from 'node:fs/promises';
import path from 'node:path';
import { readOptionalText } from './file-store.js';
import { inspectArtifact, type ArtifactSnapshot } from './artifacts.js';
import { defaultContentContext, type ContentContext } from './content-context.js';
import { readSettings } from './settings.js';
import { CLIENT_IDS, type ClientId } from './types.js';
import { managedPlan, type ArtifactRequest, type ManagedRow } from './managed-plan.js';
import { projectBlock } from './managed-block.js';
import { HubError } from './errors.js';

export const MAX_CONTEXT_BYTES = 32 * 1024;
interface ContextOwnership {
  version: 1;
  entries: { path: string; client: ClientId; blockHash: string; created: boolean }[];
}

export async function textSource(file: string) {
  const logical = await inspectArtifact(file);
  const sources: ArtifactSnapshot[] = [logical];
  if (logical.kind === 'missing') return { content: null, sources };
  const actual =
    logical.kind === 'symlink' ? await inspectArtifact(await fs.realpath(file)) : logical;
  if (actual.kind !== 'file' || (await fs.stat(actual.path)).size > 1024 * 1024)
    throw new HubError('Shared context must be a regular text file of at most 1 MiB.');
  if (actual !== logical) sources.push(actual);
  return { content: await readOptionalText(actual.path), sources };
}

function claudeImport(file: string): string {
  if (/[\r\n\0]/.test(file))
    throw new HubError('Instruction import paths cannot contain control characters.');
  return '@' + file.replace(/([\\ \t])/g, '\\$1');
}

export async function planContextSync(
  options: { client?: ClientId } = {},
  supplied?: ContentContext,
) {
  if (options.client && !CLIENT_IDS.includes(options.client)) throw new HubError('Unknown client.');
  const context = supplied ?? (await defaultContentContext());
  const settings = await readSettings(context.root);
  const instructionsPath = path.join(context.root, 'instructions', 'AGENTS.md');
  const memoryPath = path.join(context.root, 'memory', 'MEMORY.md');
  const instructions = await textSource(instructionsPath);
  const memory = await textSource(memoryPath);
  const sources = [...instructions.sources, ...memory.sources];
  const statePath = path.join(context.root, 'state', 'context.json');
  const stateBefore = await inspectArtifact(statePath);
  if (!['missing', 'file'].includes(stateBefore.kind))
    throw new HubError('Context ownership must be a regular file.');
  const stateText = await readOptionalText(statePath);
  let ownership: ContextOwnership;
  try {
    ownership = stateText === null ? { version: 1, entries: [] } : JSON.parse(stateText);
    if (
      ownership.version !== 1 ||
      !Array.isArray(ownership.entries) ||
      ownership.entries.some(
        (entry) =>
          !path.isAbsolute(entry.path) ||
          !CLIENT_IDS.includes(entry.client) ||
          !/^[a-f0-9]{64}$/.test(entry.blockHash) ||
          typeof entry.created !== 'boolean',
      ) ||
      new Set(ownership.entries.map((entry) => entry.path)).size !== ownership.entries.length
    )
      throw new Error();
  } catch {
    throw new HubError('Cannot parse shared-context ownership state.');
  }
  const next = new Map(ownership.entries.map((entry) => [entry.path, entry]));
  const rows: ManagedRow[] = [];
  const requests: ArtifactRequest[] = [];
  for (const client of context.clients) {
    if (options.client && client.id !== options.client) continue;
    const row: ManagedRow = {
      path: client.instructions,
      client: client.id,
      name: 'instructions + memory index',
      action: 'keep',
    };
    rows.push(row);
    if (!client.installed || settings.clients?.[client.id]?.enabled === false) {
      row.action = 'skip';
      row.note = client.installed ? 'Disabled in hub.yaml.' : 'Client not installed.';
      continue;
    }
    const before = await inspectArtifact(client.instructions);
    if (!['missing', 'file'].includes(before.kind)) {
      row.action = 'conflict';
      row.note =
        'Instruction target is a directory or symlink. Preserve its binding and resolve the path explicitly before delivery.';
      continue;
    }
    if (client.id === 'codex') {
      const override = await textSource(
        path.join(path.dirname(client.instructions), 'AGENTS.override.md'),
      );
      sources.push(...override.sources);
      if (override.content?.trim()) {
        row.action = 'conflict';
        row.note =
          'AGENTS.override.md shadows this global AGENTS.md. Resolve the override before delivery.';
        continue;
      }
    }
    const parts: string[] = [];
    if (instructions.content?.trim())
      parts.push(
        '## Shared instructions\n\n' +
          (client.id === 'claude-code' ? claudeImport(instructionsPath) : instructions.content),
      );
    if (memory.content?.trim())
      parts.push(
        `## Shared memory\n\nShared memory directory: ${path.join(context.root, 'memory')}\nRead the index below before using shared facts. Resolve relative fact paths against that directory; open relevant files on demand. Keep project-specific native auto-memory separate.\n\n` +
          (client.id === 'claude-code' ? claudeImport(memoryPath) : memory.content),
      );
    const current = await readOptionalText(client.instructions);
    const previous = next.get(client.instructions);
    let projection;
    try {
      projection = projectBlock(current ?? '', 'context', parts.join('\n\n'), previous?.blockHash);
    } catch (error) {
      row.action = 'conflict';
      row.note = error instanceof HubError ? error.message : 'Cannot update the owned block.';
      continue;
    }
    if (Buffer.byteLength(projection.next, 'utf8') > MAX_CONTEXT_BYTES) {
      row.action = 'conflict';
      row.note =
        'Generated instruction file exceeds the 32 KiB delivery budget. Shorten the shared context before syncing.';
      continue;
    }
    if (projection.blockHash)
      next.set(client.instructions, {
        path: client.instructions,
        client: client.id,
        blockHash: projection.blockHash,
        created: previous?.created ?? before.kind === 'missing',
      });
    else next.delete(client.instructions);
    const remove = !projection.blockHash && previous?.created && !projection.next.trim();
    if (projection.next !== (current ?? '') || (remove && before.kind !== 'missing')) {
      row.action = remove ? 'remove' : before.kind === 'missing' ? 'add' : 'replace';
      requests.push({
        before,
        client: client.id,
        value: remove
          ? { kind: 'missing' }
          : {
              kind: 'file',
              content: projection.next,
              mode: before.kind === 'file' ? before.mode : 0o600,
            },
      });
    }
    row.note =
      client.id === 'claude-code'
        ? 'Imports shared files; preserves personal text and native auto-memory.'
        : 'Embeds shared rules and memory index; preserves text outside the owned block.';
  }
  const nextText =
    JSON.stringify(
      {
        version: 1,
        entries: [...next.values()].sort((left, right) => left.path.localeCompare(right.path)),
      },
      null,
      2,
    ) + '\n';
  if (nextText !== stateText && (next.size || ownership.entries.length))
    requests.push({
      before: stateBefore,
      client: 'hub',
      value: { kind: 'file', content: nextText, mode: 0o600 },
    });
  return managedPlan(
    {
      root: context.root,
      rows,
      requests,
      sources,
      command: [
        'sync',
        '--area',
        'context',
        ...(options.client ? ['--client', options.client] : []),
      ],
    },
    { settings, context, ownership, stateBefore },
  );
}
