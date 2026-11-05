import fs from 'node:fs/promises';
import { Readable } from 'node:stream';
import readline from 'node:readline';
import type { HistoryEvent } from '../../contracts/history.js';
import { HubError } from '../../shared/errors.js';
import { selectHistoryChat, visibleHistory, type HistoryAccess } from './access.js';
import { ownedHistoryPath, readHistory, readHistoryVersion } from './storage.js';
import { rawHistory, rawWindow } from './raw.js';

export interface HistoryQuery {
  query?: string;
  client?: string;
  project?: string;
  offset?: number;
  limit?: number;
}
export function pageOptions(options: HistoryQuery) {
  const offset = options.offset ?? 0,
    limit = options.limit ?? 50;
  if (
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 100 ||
    (options.query?.length ?? 0) > 500
  )
    throw new HubError(
      'Choose a nonnegative offset, a limit of 1–100 and a query of at most 500 characters.',
    );
  return { offset, limit };
}
export async function listHistory(root: string, access: HistoryAccess, options: HistoryQuery = {}) {
  const { offset, limit } = pageOptions(options);
  const catalog = await readHistory(root);
  const all = visibleHistory(catalog, access).filter(
    (chat) =>
      (!options.client || chat.client === options.client) &&
      (!options.project || chat.projects.includes(options.project)) &&
      (!options.query ||
        `${chat.title} ${chat.nativeId}`.toLowerCase().includes(options.query.toLowerCase())),
  );
  return {
    total: all.length,
    offset,
    next: offset + limit < all.length ? offset + limit : null,
    chats: all.slice(offset, offset + limit),
  };
}
export async function* historyEvents(
  root: string,
  chat: string,
  revision: string,
  signal?: AbortSignal,
): AsyncGenerator<HistoryEvent> {
  const input = Readable.from(rawHistory(root, chat, revision, signal, 'events'));
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      signal?.throwIfAborted();
      yield JSON.parse(line) as HistoryEvent;
    }
  } catch {
    signal?.throwIfAborted();
    throw new HubError('Conversation index is unavailable. Rebuild it from preserved raw history.');
  } finally {
    lines.close();
    input.destroy();
  }
}
export async function readConversation(
  root: string,
  access: HistoryAccess,
  id: string,
  options: HistoryQuery & { revision?: string } = {},
  signal?: AbortSignal,
) {
  const { offset, limit } = pageOptions(options);
  const chat = selectHistoryChat(await readHistory(root), access, id);
  const revision = options.revision ?? chat.revision;
  if (!chat.revisions.includes(revision)) throw new HubError('Unknown conversation revision.');
  const events: (Omit<HistoryEvent, 'raw'> & { textComplete: boolean })[] = [];
  let budget = 0;
  let more = false;
  for await (const event of historyEvents(root, id, revision, signal)) {
    if (event.ordinal < offset) continue;
    const text = event.text.slice(0, 8192);
    const { raw: _raw, ...metadata } = event;
    const item = { ...metadata, text, textComplete: text.length === event.text.length };
    const bytes = Buffer.byteLength(JSON.stringify(item));
    if (events.length && (events.length >= limit || budget + bytes > 120 * 1024)) {
      more = true;
      break;
    }
    events.push(item);
    budget += bytes;
  }
  // Recheck current grants/exclusions after work; an in-flight read cannot retain revoked authority.
  selectHistoryChat(await readHistory(root), access, id);
  const next = events.length ? events.at(-1)!.ordinal + 1 : offset;
  return {
    chat: revision === chat.revision ? chat : await readHistoryVersion(root, id, revision),
    revision,
    events,
    next: more ? next : null,
    referenceData: true,
  };
}
export async function readHistoryEvent(
  root: string,
  access: HistoryAccess,
  id: string,
  ordinal: number,
  offset = 0,
  revision?: string,
) {
  if (!Number.isSafeInteger(ordinal) || ordinal < 0 || !Number.isSafeInteger(offset) || offset < 0)
    throw new HubError('Invalid event window.');
  const chat = selectHistoryChat(await readHistory(root), access, id);
  revision ??= chat.revision;
  if (!chat.revisions.includes(revision)) throw new HubError('Unknown conversation revision.');
  for await (const event of historyEvents(root, id, revision)) {
    if (event.ordinal !== ordinal) continue;
    const text = JSON.stringify(event.raw, null, 2);
    const fragment = text.slice(offset, offset + 16000);
    selectHistoryChat(await readHistory(root), access, id);
    return {
      id,
      revision,
      ordinal,
      offset,
      text: fragment,
      next: offset + fragment.length < text.length ? offset + fragment.length : null,
      referenceData: true,
    };
  }
  throw new HubError('Event not found.');
}
export async function searchHistory(
  root: string,
  access: HistoryAccess,
  options: HistoryQuery = {},
  signal?: AbortSignal,
) {
  const { offset, limit } = pageOptions(options);
  if (!options.query?.trim()) throw new HubError('Enter a search phrase.');
  const catalog = await readHistory(root);
  const matches: {
    chat: string;
    revision: string;
    ordinal: number;
    role: string;
    snippet: string;
  }[] = [];
  let total = 0;
  const needle = options.query.toLowerCase();
  const chats = visibleHistory(catalog, access).filter(
    (chat) =>
      (!options.project || chat.projects.includes(options.project)) &&
      (!options.client || chat.client === options.client),
  );
  for (const chat of chats) {
    for await (const event of historyEvents(root, chat.id, chat.revision, signal)) {
      const text = JSON.stringify(event.raw);
      const position = text.toLowerCase().indexOf(needle);
      if (position < 0) continue;
      if (total++ >= offset && matches.length < limit)
        matches.push({
          chat: chat.id,
          revision: chat.revision,
          ordinal: event.ordinal,
          role: event.role,
          snippet: text.slice(Math.max(0, position - 80), position + needle.length + 180),
        });
    }
  }
  const permitted = new Set(visibleHistory(await readHistory(root), access).map((chat) => chat.id));
  if (chats.some((chat) => !permitted.has(chat.id)))
    throw new HubError('History access changed during search. Retry in the current scope.');
  return {
    total,
    matches,
    next: offset + limit < total ? offset + limit : null,
    referenceData: true,
  };
}
export async function historyBytes(
  root: string,
  access: HistoryAccess,
  id: string,
  options: { revision?: string; asset?: string; offset?: number } = {},
) {
  const chat = selectHistoryChat(await readHistory(root), access, id);
  const revision = options.revision ?? chat.revision;
  if (!chat.revisions.includes(revision)) throw new HubError('Unknown conversation revision.');
  const version = revision === chat.revision ? chat : await readHistoryVersion(root, id, revision);
  if (!options.asset) {
    const offset = options.offset ?? 0;
    if (!Number.isSafeInteger(offset) || offset < 0) throw new HubError('Invalid byte offset.');
    const result = await rawWindow(root, id, revision, offset);
    selectHistoryChat(await readHistory(root), access, id);
    return result;
  }
  if (
    options.asset &&
    !version.assets.some((asset) => asset.id === options.asset && asset.status === 'preserved')
  )
    throw new HubError('Asset not available.');
  const file = options.asset
    ? await ownedHistoryPath(root, 'chats', id, revision, 'assets', options.asset)
    : await ownedHistoryPath(root, 'chats', id, revision, 'raw');
  const handle = await fs.open(file, 'r');
  try {
    const offset = options.offset ?? 0;
    if (!Number.isSafeInteger(offset) || offset < 0) throw new HubError('Invalid byte offset.');
    const size = (await handle.stat()).size;
    const buffer = Buffer.alloc(Math.min(64 * 1024, Math.max(0, size - offset)));
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset);
    selectHistoryChat(await readHistory(root), access, id);
    return {
      data: buffer.subarray(0, bytesRead).toString('base64'),
      offset,
      size,
      next: offset + bytesRead < size ? offset + bytesRead : null,
    };
  } finally {
    await handle.close();
  }
}
