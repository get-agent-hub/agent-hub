import { hash } from './values.js';
import { HubError } from './errors.js';

export function managedBlock(text: string, name: string) {
  const start = `<!-- agent-hub:${name}:start -->`;
  const end = `<!-- agent-hub:${name}:end -->`;
  const starts = text.split(start).length - 1;
  const ends = text.split(end).length - 1;
  if (!starts && !ends) return null;
  const first = text.indexOf(start);
  const last = text.indexOf(end);
  if (starts !== 1 || ends !== 1 || last < first)
    throw new HubError(
      'Managed block markers are malformed or duplicated. Preserve the file and resolve them before syncing.',
    );
  return { start: first, end: last + end.length, text: text.slice(first, last + end.length) };
}

/** Only the owned block is rewritten; bytes outside it remain untouched. */
export function projectBlock(text: string, name: string, body: string, previousHash?: string) {
  if (body.includes(`<!-- agent-hub:${name}:`))
    throw new HubError(
      'Shared source contains reserved managed-block markers. Resolve the source before syncing.',
    );
  const current = managedBlock(text, name);
  if (current && (!previousHash || hash(current.text) !== previousHash))
    throw new HubError(
      'The managed block was edited or has no ownership record. Review it instead of overwriting.',
    );
  if (!current && previousHash)
    throw new HubError(
      'A previously managed block was removed locally. Review the file before syncing.',
    );
  const block = body
    ? `<!-- agent-hub:${name}:start -->\n${body}\n<!-- agent-hub:${name}:end -->`
    : '';
  const next = current
    ? text.slice(0, current.start) + block + text.slice(current.end)
    : block
      ? text + (text && !text.endsWith('\n') ? '\n' : '') + block + '\n'
      : text;
  return { next, blockHash: block ? hash(block) : undefined };
}

export function hasMarkdownImport(text: string, filename: string): boolean {
  let fence: { character: string; length: number } | undefined;
  for (const line of text.split(/\r?\n/)) {
    const delimiter = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (delimiter) {
      if (!fence) fence = { character: delimiter[0]!, length: delimiter.length };
      else if (delimiter[0] === fence.character && delimiter.length >= fence.length)
        fence = undefined;
      continue;
    }
    if (!fence && [`@${filename}`, `@./${filename}`].includes(line.trim())) return true;
  }
  return false;
}
