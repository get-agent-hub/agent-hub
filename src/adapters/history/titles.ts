import type { HistoryEvent } from '../../contracts/history.js';
import { isRecord } from '../../shared/values.js';

const commandPrefix =
  /^\s*<(local-command-(?:caveat|stdout|stderr)|command-(?:name|message|args))(?:\s[^<>]*)?>/i;
const contextPrefix =
  /^\s*<(environment_context|user_instructions|turn_aborted|permissions|collaboration_mode)(?:\s[^<>]*)?>/i;
const instructionsPrefix = /^# AGENTS\.md instructions for\b/i;
const instructionsHeader = /^# AGENTS\.md instructions for [^\r\n]+\r?\n\s*/i;
const approvalPrefix = /^The following is the Codex agent history\b/;
const buildOutputPrefix = /^(?:yarn run v\d+\.\d+\.\d+(?:\s|$)|npm (?:ERR!|WARN)(?:\s|$))/;

/** Remove complete leading runtime envelopes only; quoted markup and mixed requests remain text. */
function withoutRuntimeContext(text: string) {
  let remaining = text.trim();
  while (remaining) {
    const header = instructionsHeader.exec(remaining);
    const content = header ? remaining.slice(header[0].length) : remaining;
    const opening = (header ? /^<(INSTRUCTIONS)>/i : contextPrefix).exec(content);
    if (!opening) break;
    const close = `</${opening[1]}>`;
    const end = content.indexOf(close, opening[0].length);
    if (end < 0) break;
    remaining = content.slice(end + close.length).trim();
  }
  return remaining;
}
export const runtimeContextNotice = (text: string) => !!text.trim() && !withoutRuntimeContext(text);

/** DSH fallback titles are short excerpts, not native names chosen by a user/provider. */
export function nativeHistoryTitle(event: HistoryEvent, fallback = false) {
  const row = isRecord(event.raw) ? event.raw : {};
  if (!fallback && typeof row.customTitle === 'string' && row.customTitle.trim())
    return row.customTitle.slice(0, 200);
  const data = isRecord(row.data) ? row.data : {};
  const source = isRecord(data.source) ? data.source : {};
  if (
    !fallback &&
    event.type === 'subagent/descriptor' &&
    typeof data.label === 'string' &&
    data.label.trim()
  )
    return data.label.slice(0, 200);
  if (
    event.type === 'session/title' &&
    (source.kind === 'fallback') === fallback &&
    typeof data.title === 'string' &&
    data.title.trim()
  )
    return data.title.slice(0, 200);
  return undefined;
}

// Only complete, standalone Claude notices are context. A quoted notice plus a request stays a message.
export function localCommandNotice(text: string) {
  let remaining = text.trim();
  if (!remaining) return false;
  while (remaining) {
    const opening = commandPrefix.exec(remaining);
    if (!opening) return false;
    const close = `</${opening[1]}>`;
    const end = remaining.indexOf(close, opening[0].length);
    if (end < 0) return false;
    remaining = remaining.slice(end + close.length).trim();
  }
  return true;
}

const greetings = new Set([
  'hi',
  'hello',
  'hey',
  'привет',
  'здравствуй',
  'здравствуйте',
  'тут',
  'ты тут',
  'are you there',
]);
const greeting = (text: string) =>
  greetings.has(
    text
      .trim()
      .replace(/[.!?…]+$/u, '')
      .toLowerCase(),
  );

/** Clean only known transport wrappers for a title, never render or rewrite message bodies. */
function titleText(text: string) {
  return text.replace(/<\/?pasted_content(?:\s+[^<>]*)?>/gi, '').trim();
}
export function titleNeedsRepair(title: string, nativeId: string) {
  return (
    !title.trim() ||
    title === `Conversation ${nativeId}` ||
    commandPrefix.test(title) ||
    contextPrefix.test(title) ||
    instructionsPrefix.test(title) ||
    approvalPrefix.test(title) ||
    buildOutputPrefix.test(title) ||
    /<\/?pasted_content\b/i.test(title) ||
    greeting(title)
  );
}
export function messageTitle(event: HistoryEvent) {
  if (event.category !== 'message' || event.role !== 'user') return undefined;
  const text =
    event.parts
      ?.filter((part) => part.kind === 'text')
      .map((part) => part.text)
      .join('\n') ?? '';
  if (!text.trim() || localCommandNotice(text)) return undefined;
  const clean = withoutRuntimeContext(titleText(text));
  const lines = clean.split(/\r?\n/);
  while (lines.length > 1 && (!lines[0]!.trim() || greeting(lines[0]!))) lines.shift();
  const candidate = lines.join(' ').replace(/\s+/g, ' ').trim();
  if (!candidate || greeting(candidate)) return undefined;
  if (approvalPrefix.test(candidate)) return 'Approval review';
  if (buildOutputPrefix.test(candidate)) return 'Build output';
  if (candidate.length <= 160) return candidate;
  const prefix = Array.from(candidate).slice(0, 159).join('');
  const boundary = prefix.lastIndexOf(' ');
  return (boundary >= 100 ? prefix.slice(0, boundary) : prefix) + '…';
}
