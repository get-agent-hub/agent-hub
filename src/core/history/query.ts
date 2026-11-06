import fs from 'node:fs/promises';
import { Readable } from 'node:stream';
import readline from 'node:readline';
import type { HistoryEvent } from '../../contracts/history.js';
import { HubError } from '../../shared/errors.js';
import { selectHistoryChat, visibleHistory, type HistoryAccess } from './access.js';
import { ownedHistoryPath, readHistory, readHistoryVersion } from './storage.js';
import { rawHistory, rawWindow } from './raw.js';
import { historyEvent } from '../../adapters/history/events.js';
import { historyChatSummary } from './summary.js';
import {
  conversationFilter,
  publicHistoryEvent,
  titledHistoryChat,
  type HistoryView,
} from './presentation.js';

export interface HistoryQuery {
  query?: string;
  client?: string;
  project?: string;
  offset?: number;
  limit?: number;
  view?: HistoryView;
  sort?: 'newest' | 'oldest';
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
    (options.query?.length ?? 0) > 500 ||
    (options.view !== undefined && !['events', 'conversation'].includes(options.view)) ||
    (options.sort !== undefined && !['newest', 'oldest'].includes(options.sort))
  )
    throw new HubError(
      'Choose a nonnegative offset, a limit of 1–100, a query of at most 500 characters and newest/oldest sorting.',
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
  const candidates = options.sort ? all : all.slice(offset, offset + limit);
  const presented: Awaited<ReturnType<typeof titledHistoryChat>>[] = [];
  // Global sorting needs every matching date, with bounded concurrent file readers.
  for (let start = 0; start < candidates.length; start += 8) {
    presented.push(
      ...(await Promise.all(
        candidates
          .slice(start, start + 8)
          .map((chat) =>
            historyChatSummary(root, chat, () => historyEvents(root, chat.id, chat.revision)),
          ),
      )),
    );
  }
  if (options.sort)
    presented.sort((a, b) => {
      if (!a.startedAt || !b.startedAt) return a.startedAt ? -1 : b.startedAt ? 1 : 0;
      const difference = Date.parse(a.startedAt) - Date.parse(b.startedAt);
      return options.sort === 'oldest' ? difference : -difference;
    });
  const chats = options.sort ? presented.slice(offset, offset + limit) : presented;
  const permitted = new Set(visibleHistory(await readHistory(root), access).map((chat) => chat.id));
  if (chats.some((chat) => !permitted.has(chat.id)))
    throw new HubError('History access changed. Refresh the current scope.');
  return {
    total: all.length,
    offset,
    next: offset + limit < all.length ? offset + limit : null,
    chats,
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
      const stored = JSON.parse(line) as HistoryEvent;
      yield historyEvent(stored.raw, stored.ordinal);
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
  const events: ReturnType<typeof publicHistoryEvent>[] = [];
  const visible = conversationFilter();
  const before: number[] = [];
  let budget = 0;
  let more = false;
  for await (const event of historyEvents(root, id, revision, signal)) {
    if (options.view === 'conversation' && !visible(event)) continue;
    if (event.ordinal < offset) {
      before.push(event.ordinal);
      if (before.length > limit) before.shift();
      continue;
    }
    const item = publicHistoryEvent(event);
    const bytes = Buffer.byteLength(JSON.stringify(item));
    if (events.length && (events.length >= limit || budget + bytes > 120 * 1024)) {
      more = true;
      break;
    }
    events.push(item);
    budget += bytes;
  }
  // Recheck current grants/exclusions after work; an in-flight read cannot retain revoked authority.
  const versionChat =
    revision === chat.revision ? chat : await readHistoryVersion(root, id, revision);
  const displayChat = await titledHistoryChat(
    versionChat,
    historyEvents(root, id, revision, signal),
    signal,
  );
  selectHistoryChat(await readHistory(root), access, id);
  const next = events.length ? events.at(-1)!.ordinal + 1 : offset;
  return {
    chat: displayChat,
    revision,
    events,
    next: more ? next : null,
    previous: before[0] ?? null,
    view: options.view ?? 'events',
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
    const visible = conversationFilter();
    for await (const event of historyEvents(root, chat.id, chat.revision, signal)) {
      if (options.view === 'conversation' && !visible(event)) continue;
      const text = JSON.stringify(event.raw);
      const position = text.toLowerCase().indexOf(needle);
      if (position < 0) continue;
      const readable = event.text.toLowerCase().indexOf(needle);
      const displayText = readable >= 0 ? event.text : text;
      const displayPosition = readable >= 0 ? readable : position;
      if (total++ >= offset && matches.length < limit)
        matches.push({
          chat: chat.id,
          revision: chat.revision,
          ordinal: event.ordinal,
          role: event.role,
          snippet: displayText.slice(
            Math.max(0, displayPosition - 80),
            displayPosition + needle.length + 180,
          ),
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
