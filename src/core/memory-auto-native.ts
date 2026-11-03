import fs from 'node:fs/promises';
import path from 'node:path';
import { TextDecoder } from 'node:util';
import { parse } from 'yaml';
import { inspectArtifact, sameArtifact, containsPath, type ArtifactSnapshot } from './artifacts.js';
import { hash, isRecord } from './values.js';
import { HubError } from './errors.js';
import type { ClientId } from './types.js';
import type { AutoFact } from './memory-auto-config.js';

export interface NativeFact extends Omit<AutoFact, 'key'> {
  key: string;
  client: ClientId;
  source: string;
}

function splitNote(
  text: string,
  filename: string,
): (Omit<NativeFact, 'key' | 'client' | 'source'> & { identity: string })[] {
  const header = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(text);
  let title = path.basename(filename, path.extname(filename));
  let kind: AutoFact['kind'] = 'fact';
  if (header) {
    const metadata: unknown = parse(header[1]!, { maxAliasCount: 0, uniqueKeys: true });
    if (!isRecord(metadata)) throw new HubError('Native memory metadata must be an object.');
    if (typeof metadata.name === 'string') title = metadata.name;
    if (metadata.type === 'user') kind = 'preference';
    if (metadata.type === 'feedback') kind = 'lesson';
    text = text.slice(header[0].length);
    return text.trim()
      ? [
          {
            title,
            kind,
            body: trimBlankLines(text),
            evidence: `Native memory note: ${filename}`,
            identity: 'document',
          },
        ]
      : [];
  }
  const sections = [{ title, identity: 'document', lines: [] as string[] }];
  let fence: { character: string; length: number } | undefined;
  let titleRead = false;
  for (const line of text.replace(/\r\n/g, '\n').split('\n')) {
    const delimiter = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (delimiter) {
      const marker = delimiter[1]!;
      if (!fence && !(marker[0] === '`' && delimiter[2]!.includes('`')))
        fence = { character: marker[0]!, length: marker.length };
      else if (
        fence &&
        marker[0] === fence.character &&
        marker.length >= fence.length &&
        !delimiter[2]!.trim()
      )
        fence = undefined;
      sections.at(-1)!.lines.push(line);
      continue;
    }
    const heading = !fence && /^ {0,3}(#{1,2})[ \t]+(.+?)\s*$/.exec(line);
    const headingTitle = heading ? heading[2]!.replace(/[ \t]+#+[ \t]*$/, '').trim() : '';
    if (heading && heading[1] === '##') {
      sections.push({
        title: headingTitle,
        identity: `heading:${headingTitle.toLowerCase()}`,
        lines: [],
      });
    } else if (
      heading &&
      !titleRead &&
      sections.length === 1 &&
      !sections[0]!.lines.some((value) => value.trim())
    ) {
      sections[0]!.title = headingTitle;
      titleRead = true;
    } else sections.at(-1)!.lines.push(line);
  }
  return sections.flatMap((section) => {
    const body = trimBlankLines(section.lines.join('\n'));
    return body.trim()
      ? [
          {
            title: section.title,
            identity: section.identity,
            body,
            kind,
            evidence: `Native memory note: ${filename}`,
          },
        ]
      : [];
  });
}

/** Preserve indentation and whitespace inside code; only remove surrounding blank lines. */
function trimBlankLines(text: string) {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/^(?:[ \t]*\n)+/, '')
    .replace(/(?:\n[ \t]*)+$/, '');
}

export async function scanNativeMemory(
  root: string,
  source: { client: ClientId; directory: string },
) {
  const directory = path.resolve(source.directory);
  const facts: NativeFact[] = [];
  const sources: ArtifactSnapshot[] = [];
  const skipped: { path: string; reason: string }[] = [];
  let total = 0;
  let files = 0;
  const inspect = async (folder: string, depth: number) => {
    const before = await inspectArtifact(folder);
    if (before.kind === 'missing') {
      sources.push(before);
      skipped.push({
        path: folder,
        reason: 'Native memory directory is missing; no notes imported.',
      });
      return;
    }
    if (before.kind !== 'directory')
      throw new HubError('A native memory source must be a real directory.');
    if (before.physicalPath !== folder)
      throw new HubError('Native memory directory binding changed; review its source policy.');
    const actual = await fs.realpath(folder);
    const hub = await fs.realpath(root);
    if (containsPath(hub, actual) || containsPath(actual, hub))
      throw new HubError('Native memory and Hub storage must not overlap.');
    sources.push(before);
    for (const item of (await fs.readdir(folder, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      if (item.name.startsWith('.')) continue;
      const file = path.join(folder, item.name);
      if (item.isSymbolicLink()) {
        skipped.push({ path: file, reason: 'Symlink preserved; not imported.' });
        continue;
      }
      if (item.isDirectory()) {
        if (depth >= 4) throw new HubError('Native memory exceeds the supported directory depth.');
        await inspect(file, depth + 1);
      } else if (
        item.isFile() &&
        item.name.toLowerCase().endsWith('.md') &&
        item.name.toLowerCase() !== 'memory.md'
      ) {
        const snapshot = await inspectArtifact(file);
        const size = (await fs.stat(file)).size;
        if (++files > 100 || size > 128 * 1024 || (total += size) > 2 * 1024 * 1024)
          throw new HubError('Native memory scan exceeds its file/byte budget.');
        const bytes = await fs.readFile(file);
        if (bytes.length > 128 * 1024 || !sameArtifact(snapshot, await inspectArtifact(file)))
          throw new HubError(
            'Native memory changed while reading. Retry after its writer finishes.',
          );
        sources.push(snapshot);
        let notes;
        try {
          notes = splitNote(new TextDecoder('utf-8', { fatal: true }).decode(bytes), file);
        } catch {
          skipped.push({
            path: file,
            reason: 'Malformed native Markdown/metadata; source preserved.',
          });
          continue;
        }
        const seen = new Set<string>();
        for (const note of notes) {
          const { identity, ...content } = note;
          const key = `native:${source.client}:${file}:${hash(identity)}`;
          if (seen.has(key))
            throw new HubError(
              'Native memory has duplicate headings; resolve their identity before import.',
            );
          seen.add(key);
          facts.push({ ...content, key, client: source.client, source: file });
        }
      }
    }
    if (!sameArtifact(before, await inspectArtifact(folder)))
      throw new HubError('Native memory changed during discovery. Retry.');
  };
  await inspect(directory, 0);
  if (facts.length > 200)
    throw new HubError('Native memory contains too many sections for one scan.');
  return { facts, sources, skipped };
}
