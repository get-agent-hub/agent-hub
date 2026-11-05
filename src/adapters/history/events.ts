import type { HistoryEvent } from '../../contracts/history.js';
import { isAbsoluteLocalPath } from '../../shared/paths.js';
import { historyParts } from './content.js';

export const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const string = (value: unknown) => (typeof value === 'string' ? value : null);
const contextSources = new Set([
  'runtime-context',
  'skill-catalog',
  'time-context',
  'system-prompt',
]);
function timestamp(value: unknown) {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 8640000000000000)
    return new Date(value).toISOString();
  return null;
}

/** Interpret native envelopes without treating stored content as executable instructions. */
export function historyEvent(raw: unknown, ordinal: number): HistoryEvent {
  const row = object(raw),
    data = object(row.data),
    payload = object(row.payload);
  const message = object(row.message ?? data.message ?? payload.message);
  const type = string(row.type) ?? string(payload.type) ?? 'unknown';
  let role =
    string(message.role) ??
    string(data.role) ??
    string(payload.role) ??
    string(row.role) ??
    (['user', 'assistant', 'system', 'developer', 'tool'].includes(type.split('/')[0]!)
      ? type.split('/')[0]!
      : 'event');
  const content = message.content ?? data.content ?? payload.content ?? row.content;
  let parts = historyParts(content);
  const native = type === 'response_item' ? payload : row;
  if (
    [
      'function_call',
      'custom_tool_call',
      'function_call_output',
      'custom_tool_call_output',
    ].includes(String(native.type))
  ) {
    parts = historyParts([native]);
    role = String(native.type).endsWith('_output') ? 'tool' : 'assistant';
  }
  if (type === 'tool/call') parts = historyParts([{ type: 'tool-call', ...data, id: data.callId }]);
  if (type === 'response_item' && payload.type === 'reasoning') {
    parts = historyParts(payload.summary).map((part) => ({ ...part, kind: 'reasoning' as const }));
    role = 'assistant';
  }
  const source = object(message.source ?? data.source ?? row.source);
  const category =
    ['system', 'developer'].includes(role) || contextSources.has(String(source.kind))
      ? 'context'
      : role === 'tool' || type === 'tool/call'
        ? 'tool'
        : ['user', 'assistant'].includes(role) && parts.length > 0
          ? 'message'
          : 'activity';
  let text = parts
    .map((part) =>
      part.kind === 'tool-call'
        ? `Tool: ${part.name ?? part.id ?? 'call'}\n${part.text}`
        : part.text,
    )
    .join('\n');
  if (!text)
    text =
      string(payload.message) ??
      string(payload.text) ??
      string(data.text) ??
      string(row.text) ??
      JSON.stringify(raw);
  return {
    ordinal,
    nativeId:
      string(row.uuid) ??
      string(message.id) ??
      string(data.id) ??
      string(row.id) ??
      string(payload.id),
    parentId: string(row.parentUuid) ?? string(row.parentId),
    type,
    role,
    timestamp: timestamp(row.timestamp ?? row.time ?? payload.timestamp),
    text,
    raw,
    category,
    parts,
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
  const row = object(raw),
    data = object(row.data),
    payload = object(row.payload);
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
  if (!context.title && event.category === 'message' && event.role === 'user') {
    const first = event.parts?.find((part) => part.kind === 'text')?.text;
    if (first) context.title = first.replace(/\s+/g, ' ').slice(0, 160);
  }
  if (row.type === 'session/title' && typeof data.title === 'string')
    context.title = data.title.slice(0, 200);
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
