import fs from 'node:fs/promises';
import path from 'node:path';
import { TextDecoder } from 'node:util';
import { parse, stringify } from 'yaml';
import { inspectArtifact, sameArtifact, type ArtifactSnapshot } from './artifacts.js';
import { HubError } from './errors.js';
import { hash, isRecord } from './values.js';

export const MEMORY_LIMIT = 128 * 1024;
export const memoryKinds = ['fact', 'preference', 'decision', 'lesson'] as const;
export interface MemoryRecord {
  version: 1;
  id: string;
  title: string;
  scope: string;
  kind: (typeof memoryKinds)[number];
  tags: string[];
  source?: string;
  created: string;
  updated: string;
  body: string;
  revision: string;
}
export interface MemoryLocation {
  root: string;
  scope: string;
  directory: string;
  records: string;
  index: string;
  ownership: string;
  guards: ArtifactSnapshot[];
}

export function memoryId(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(value))
    throw new HubError('Memory IDs must use 1–64 lowercase letters, digits or hyphens.');
  return value;
}

export function memoryText(value: unknown, label: string, limit: number): string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > limit ||
    [...value].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
  )
    throw new HubError(`${label} must be non-empty, single-line text (up to ${limit} characters).`);
  return value;
}

export function memoryTime(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  )
    throw new HubError('Memory timestamps must be ISO UTC timestamps.');
  return value;
}

/** Managed memory never follows symlinks below the explicitly selected Hub. */
export async function memoryPath(root: string, file: string, directory = false) {
  const relative = path.relative(path.resolve(root), path.resolve(file));
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))
    throw new HubError('Memory path escapes the selected Hub.');
  let current = path.resolve(root);
  const parts = relative.split(path.sep).filter(Boolean);
  for (const [index, part] of parts.entries()) {
    current = path.join(current, part);
    try {
      const stat = await fs.lstat(current);
      const expectDirectory = index < parts.length - 1 || directory;
      if (stat.isSymbolicLink() || (expectDirectory ? !stat.isDirectory() : !stat.isFile()))
        throw new HubError(
          `Memory requires a real ${expectDirectory ? 'directory' : 'file'}: ${current}.`,
        );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
}

export async function memoryFile(root: string, file: string) {
  await memoryPath(root, file);
  const snapshot = await inspectArtifact(file);
  if (snapshot.kind === 'missing') return { snapshot, text: null };
  if ((await fs.stat(file)).size > MEMORY_LIMIT)
    throw new HubError(`Memory file exceeds ${MEMORY_LIMIT} bytes: ${file}.`);
  const bytes = await fs.readFile(file);
  if (bytes.length > MEMORY_LIMIT)
    throw new HubError(`Memory file exceeds ${MEMORY_LIMIT} bytes: ${file}.`);
  if (!sameArtifact(snapshot, await inspectArtifact(file)))
    throw new HubError('Memory file changed while reading; retry.');
  try {
    return { snapshot, text: new TextDecoder('utf-8', { fatal: true }).decode(bytes) };
  } catch {
    throw new HubError(`Memory file is not valid UTF-8: ${file}.`);
  }
}

export function validateMemory(value: unknown): Omit<MemoryRecord, 'revision'> {
  if (
    !isRecord(value) ||
    Object.keys(value).some(
      (key) =>
        ![
          'version',
          'id',
          'title',
          'scope',
          'kind',
          'tags',
          'source',
          'created',
          'updated',
          'body',
        ].includes(key),
    )
  )
    throw new HubError('Memory metadata contains unknown fields.');
  if (
    value.version !== 1 ||
    typeof value.scope !== 'string' ||
    (value.scope !== 'shared' && !/^project:[a-z0-9][a-z0-9-]{0,63}$/.test(value.scope))
  )
    throw new HubError('Memory metadata has an invalid version or scope.');
  if (!memoryKinds.includes(value.kind as MemoryRecord['kind']))
    throw new HubError('Choose a known memory kind.');
  if (
    !Array.isArray(value.tags) ||
    value.tags.length > 20 ||
    new Set(value.tags).size !== value.tags.length
  )
    throw new HubError('Memory tags must be a unique list of up to 20 strings.');
  const tags = value.tags.map((tag) => memoryText(tag, 'Tag', 64));
  if (
    typeof value.body !== 'string' ||
    !value.body.trim() ||
    value.body.includes('\0') ||
    Buffer.byteLength(value.body) > MEMORY_LIMIT
  )
    throw new HubError('Memory body must be non-empty UTF-8 text within the size limit.');
  const created = memoryTime(value.created);
  const updated = memoryTime(value.updated);
  if (updated < created) throw new HubError('Memory update time cannot precede creation.');
  return {
    version: 1,
    id: memoryId(value.id),
    title: memoryText(value.title, 'Title', 200),
    scope: value.scope,
    kind: value.kind as MemoryRecord['kind'],
    tags,
    ...(value.source === undefined ? {} : { source: memoryText(value.source, 'Source', 2048) }),
    created,
    updated,
    body: value.body,
  };
}

export function encodeMemory(value: Omit<MemoryRecord, 'revision'>): string {
  const { body, ...metadata } = validateMemory(value);
  const result = `---\n${stringify(metadata, { lineWidth: 0 })}---\n${body}`;
  if (Buffer.byteLength(result) > MEMORY_LIMIT)
    throw new HubError('Memory record exceeds the file size limit.');
  return result;
}

export function decodeMemory(text: string, id: string, scope: string): MemoryRecord {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(text);
  if (!match) throw new HubError(`Memory record ${id} needs YAML frontmatter.`);
  try {
    const metadata: unknown = parse(match[1]!, { maxAliasCount: 0, uniqueKeys: true });
    if (!isRecord(metadata)) throw new HubError('Expected a metadata object.');
    if (Object.hasOwn(metadata, 'body'))
      throw new HubError('The record body belongs below the frontmatter.');
    const record = validateMemory({ ...metadata, body: match[2]! });
    if (record.id !== id || record.scope !== scope)
      throw new HubError('Record identity does not match its location.');
    return { ...record, revision: hash(text) };
  } catch (error) {
    throw new HubError(
      `Invalid memory record ${id}: ${error instanceof Error ? error.message : 'invalid metadata'}`,
    );
  }
}

export async function readMemoryCollection(location: MemoryLocation) {
  await memoryPath(location.root, location.records, true);
  let names: string[];
  try {
    names = await fs.readdir(location.records);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    names = [];
  }
  if (names.length > 2000)
    throw new HubError('Memory collection exceeds the supported 2000-record limit.');
  const entries = [];
  for (const name of names.sort()) {
    if (!name.endsWith('.md'))
      throw new HubError(`Unexpected file in managed memory records: ${name}.`);
    const id = memoryId(name.slice(0, -3));
    const file = await memoryFile(location.root, path.join(location.records, name));
    if (file.text === null) throw new HubError('Memory changed while reading; retry.');
    entries.push({ record: decodeMemory(file.text, id, location.scope), snapshot: file.snapshot });
  }
  return entries;
}

export function memorySummary(record: MemoryRecord) {
  const { body: _body, ...summary } = record;
  return summary;
}

export async function queryMemory(locations: MemoryLocation[], query = '', limit = 50) {
  if (
    typeof query !== 'string' ||
    query.length > 500 ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 100
  )
    throw new HubError('Search needs a query up to 500 characters and a limit from 1 to 100.');
  const words = query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const results = [];
  for (const location of locations) {
    for (const { record } of await readMemoryCollection(location)) {
      const text =
        `${record.id}\n${record.title}\n${record.kind}\n${record.tags.join(' ')}\n${record.body}`.toLocaleLowerCase();
      if (words.every((word) => text.includes(word))) {
        const start = words.length
          ? Math.max(0, record.body.toLocaleLowerCase().indexOf(words[0]!) - 60)
          : 0;
        results.push({ ...memorySummary(record), snippet: record.body.slice(start, start + 240) });
      }
    }
  }
  return { results: results.slice(0, limit), total: results.length };
}
