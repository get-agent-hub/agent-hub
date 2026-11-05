import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { HistoryCatalog } from '../../contracts/history.js';
import { HubError } from '../../shared/errors.js';
import { snapshot, writeChecked } from '../../shared/file-store.js';

const id = z.string().regex(/^[a-f0-9]{64}$/);
const source = z.object({
  id,
  client: z.enum(['claude-code', 'codex', 'dsh']),
  root: z.string(),
  label: z.string(),
  layout: z.enum(['claude', 'codex', 'dsh']),
  binding: z.string().optional(),
});
const catalogSchema = z.object({
  version: z.literal(1),
  sources: z.array(source),
  receipts: z.array(
    z.object({
      source,
      coverage: z.enum(['complete', 'partial', 'not-found', 'unavailable']),
      checked: z.number(),
      changed: z.number(),
      bytes: z.number(),
      issues: z.array(z.string()),
      checkedAt: z.string(),
    }),
  ),
  chats: z.array(
    z.object({
      id,
      sourceId: id,
      client: z.enum(['claude-code', 'codex', 'dsh']),
      nativeId: z.string(),
      relative: z.string(),
      title: z.string(),
      parentNativeId: z.string().nullable(),
      kind: z.enum(['chat', 'subagent']),
      locations: z.array(z.string()),
      projects: z.array(id),
      revision: id,
      revisions: z.array(id),
      events: z.number().int().nonnegative(),
      bytes: z.number().nonnegative(),
      indexedBytes: z.number().nonnegative(),
      content: z.enum(['complete', 'pending-tail', 'partial', 'unsupported']),
      assets: z.array(
        z.object({
          id,
          reference: z.string(),
          status: z.enum(['preserved', 'missing', 'outside-source', 'remote', 'embedded']),
          digest: id.optional(),
          bytes: z.number().optional(),
        }),
      ),
      issues: z.array(z.string()),
      observedAt: z.string(),
      sourceStamp: z.string().optional(),
    }),
  ),
  projects: z.array(
    z.object({
      id,
      key: z.string(),
      label: z.string(),
      kind: z.enum(['repository', 'folder', 'missing', 'unverified']),
      locations: z.array(z.string()),
      aliases: z.array(z.string()),
      binding: z.string().optional(),
    }),
  ),
  excluded: z.array(z.string()),
  deleted: z.array(id),
  tombstones: z
    .array(
      z.object({
        id,
        sourceId: id,
        relative: z.string(),
        nativeId: z.string(),
        sourceStamp: z.string().optional(),
      }),
    )
    .default([]),
  grants: z
    .array(z.object({ id: z.string(), projects: z.array(id), sources: z.array(id) }))
    .default([]),
});
export const emptyHistory = (): HistoryCatalog => ({
  version: 1,
  sources: [],
  receipts: [],
  chats: [],
  projects: [],
  excluded: [],
  deleted: [],
  tombstones: [],
  grants: [],
});
export const historyDirectory = (root: string) => path.join(root, 'state', 'history');

/** Refuse links in owned storage. The Hub itself may be reached through its established path. */
export async function ownedHistoryPath(root: string, ...parts: string[]) {
  const base = path.resolve(root);
  let current = base;
  for (const part of ['state', 'history', ...parts]) {
    if (!part || part === '.' || part === '..' || part.includes('/') || part.includes('\\'))
      throw new HubError('Invalid archive path.');
    current = path.join(current, part);
    try {
      if ((await fs.lstat(current)).isSymbolicLink())
        throw new HubError(
          'Archive storage contains a symbolic link. Restore its original location.',
        );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  return current;
}
export async function readHistory(root: string): Promise<HistoryCatalog> {
  const file = await ownedHistoryPath(root, 'catalog.json');
  const before = await snapshot(file);
  if (before.content === null) return emptyHistory();
  try {
    return catalogSchema.parse(JSON.parse(before.content));
  } catch {
    throw new HubError(
      'Archive catalog is invalid or uses a newer format. Keep the original files and restore a compatible catalog.',
    );
  }
}
export async function writeHistory(root: string, catalog: HistoryCatalog) {
  const file = await ownedHistoryPath(root, 'catalog.json');
  const before = await snapshot(file);
  await writeChecked({ ...before, mode: 0o600 }, JSON.stringify(catalog) + '\n');
}
export async function revisionDirectory(root: string, chat: string, revision: string) {
  if (!/^[a-f0-9]{64}$/.test(chat) || !/^[a-f0-9]{64}$/.test(revision))
    throw new HubError('Invalid conversation reference.');
  return ownedHistoryPath(root, 'chats', chat, revision);
}

export async function readHistoryVersion(root: string, chat: string, revision: string) {
  const file = await ownedHistoryPath(root, 'chats', chat, revision, 'manifest.json');
  try {
    const value = JSON.parse(await fs.readFile(file, 'utf8')) as {
      version?: unknown;
      chat?: unknown;
    };
    if (value.version !== 1) throw new Error();
    const result = catalogSchema.shape.chats.element.parse(value.chat);
    if (result.id !== chat || result.revision !== revision) throw new Error();
    return result;
  } catch {
    throw new HubError('Conversation version metadata is unavailable or invalid.');
  }
}
