import type { HistoryEvent } from '../../contracts/history.js';
import { isAbsoluteLocalPath } from '../../shared/paths.js';

export const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const string = (value: unknown) => (typeof value === 'string' ? value : null);

/** No interpretation is required to preserve unknown events: the complete native value is retained. */
export function historyEvent(raw: unknown, ordinal: number): HistoryEvent {
  const row = object(raw);
  const payload = object(row.payload);
  const message = object(row.message ?? payload.message);
  const type = string(row.type) ?? string(payload.type) ?? 'unknown';
  const role =
    string(message.role) ??
    string(payload.role) ??
    string(row.role) ??
    (['user', 'assistant', 'system', 'developer', 'tool'].includes(type.split('/')[0]!)
      ? type.split('/')[0]!
      : 'event');
  let text: string;
  const content = message.content ?? payload.content ?? row.content;
  if (typeof content === 'string') text = content;
  else if (Array.isArray(content))
    text = content
      .map((part) => {
        const block = object(part);
        return (
          string(block.text) ??
          string(block.thinking) ??
          string(block.content) ??
          JSON.stringify(part)
        );
      })
      .join('\n');
  else text = string(payload.message) ?? string(payload.text) ?? string(row.text) ?? '';
  // Raw event display also makes compact streams, tool data and unknown fields searchable.
  if (!text) text = JSON.stringify(raw);
  return {
    ordinal,
    nativeId: string(row.uuid) ?? string(row.id) ?? string(payload.id),
    parentId: string(row.parentUuid) ?? string(row.parentId),
    type,
    role,
    timestamp: string(row.timestamp) ?? string(payload.timestamp),
    text,
    raw,
  };
}

export interface NativeContext {
  id?: string;
  title?: string;
  parent?: string;
  subagent: boolean;
  locations: Set<string>;
  assets: Set<string>;
  unsupported: boolean;
}
export function observeHistory(context: NativeContext, raw: unknown) {
  const row = object(raw);
  const payload = object(row.payload);
  if (row.type === 'session_meta' || row.type === 'session') {
    context.id ??= string(payload.id) ?? string(row.id) ?? undefined;
    context.parent ??= string(row.parentSession) ?? string(payload.forked_from_id) ?? undefined;
    const origin = object(payload.source);
    context.subagent ||= row.origin === 'subagent' || !!origin.subagent;
    if (row.type === 'session' && typeof row.version === 'number' && row.version > 4)
      context.unsupported = true;
  }
  context.id ??= string(row.sessionId) ?? undefined;
  context.subagent ||= row.isSidechain === true;
  const event = historyEvent(raw, 0);
  if (!context.title && event.role === 'user' && event.text && !event.text.startsWith('{'))
    context.title = event.text.replace(/\s+/g, ' ').slice(0, 160);
  if (typeof row.customTitle === 'string') context.title = row.customTitle.slice(0, 200);
  for (const cwd of [row.cwd, payload.cwd])
    if (isAbsoluteLocalPath(cwd)) context.locations.add(cwd);
  const pending: unknown[] = [raw];
  while (pending.length) {
    const value = pending.pop();
    if (!value || typeof value !== 'object') continue;
    for (const [key, item] of Object.entries(value)) {
      if (['image_url', 'url', 'file_path', 'filePath'].includes(key) && typeof item === 'string')
        context.assets.add(item);
      if (item && typeof item === 'object') pending.push(item);
    }
  }
}
