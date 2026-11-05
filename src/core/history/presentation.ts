import type { HistoryChat, HistoryEvent, HistoryPart } from '../../contracts/history.js';
import { object } from '../../adapters/history/events.js';
import { messageTitle, titleNeedsRepair } from '../../adapters/history/titles.js';

export type HistoryView = 'events' | 'conversation';

/** Filter only the display projection. Original ordinals and all raw records remain accessible. */
export function conversationFilter() {
  const calls = new Set<string>();
  return (event: HistoryEvent) => {
    if (event.category === 'context' || event.category === 'activity') return false;
    const tools = event.parts?.filter((part) => part.kind === 'tool-call') ?? [];
    let duplicate = tools.length > 0;
    for (const part of tools) {
      const key = JSON.stringify([part.id, part.name, part.text]);
      if (!part.id || !calls.has(key)) duplicate = false;
      if (part.id) calls.add(key);
    }
    return event.type !== 'tool/call' || !duplicate;
  };
}
export function publicHistoryEvent(event: HistoryEvent) {
  const { raw: _raw, parts = [], ...metadata } = event;
  const previews: HistoryPart[] = [];
  let available = 8192;
  let complete = true;
  for (const part of parts) {
    if (!available || previews.length >= 50) {
      complete = false;
      break;
    }
    const text = part.text.slice(0, available);
    previews.push({ ...part, text });
    available -= text.length;
    complete &&= text.length === part.text.length;
  }
  return {
    ...metadata,
    text: event.text.slice(0, 8192),
    parts: previews,
    textComplete: complete && event.text.length <= 8192,
  };
}

/** Derive list metadata from a bounded native prefix; never substitute the archive capture time. */
export async function titledHistoryChat(
  chat: HistoryChat,
  events: AsyncIterable<HistoryEvent>,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  const repairTitle = titleNeedsRepair(chat.title, chat.nativeId);
  let title = repairTitle ? undefined : chat.title;
  let nativeTitle = false;
  let startedAt: string | null = null;
  let bytes = 0;
  try {
    for await (const event of events) {
      const row = object(event.raw),
        data = object(row.data);
      const time = event.timestamp;
      if (time && /T.*(?:Z|[+-]\d{2}:?\d{2})$/i.test(time) && Number.isFinite(Date.parse(time)))
        startedAt ??= new Date(time).toISOString();
      const native = event.type === 'session/title' ? data.title : row.customTitle;
      if (repairTitle && !nativeTitle && typeof native === 'string' && native.trim()) {
        title = native.slice(0, 200);
        nativeTitle = true;
      }
      if (repairTitle && !nativeTitle) title ??= messageTitle(event);
      if (startedAt && (!repairTitle || nativeTitle)) break;
      bytes += event.text.length;
      if (event.ordinal >= 255 || bytes >= 1024 * 1024) break;
    }
  } catch {
    signal?.throwIfAborted();
    return {
      ...chat,
      title: title ?? `Conversation ${chat.nativeId}`,
      startedAt,
      issues: [
        ...chat.issues,
        repairTitle
          ? 'The conversation title could not be fully checked because its saved event index is unavailable.'
          : 'The conversation time could not be checked because its saved event index is unavailable.',
      ],
    };
  }
  return { ...chat, title: title ?? `Conversation ${chat.nativeId}`, startedAt };
}
