import type { HistoryEvent } from '../../contracts/history.js';

const commandPrefix =
  /^\s*<(local-command-(?:caveat|stdout|stderr)|command-(?:name|message|args))(?:\s[^<>]*)?>/i;

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
  const clean = titleText(text);
  const lines = clean.split(/\r?\n/);
  while (lines.length > 1 && (!lines[0]!.trim() || greeting(lines[0]!))) lines.shift();
  const candidate = lines.join(' ').replace(/\s+/g, ' ').trim();
  return !candidate || greeting(candidate) ? undefined : candidate.slice(0, 160);
}
