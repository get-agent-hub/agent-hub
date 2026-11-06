import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { HubError } from '../../shared/errors.js';
import { ownedHistoryPath } from './storage.js';

const blockSize = 1024 * 1024;
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const descriptor = z.object({
  version: z.literal(1),
  size: z.number().int().nonnegative(),
  digest: z.string().regex(/^[a-f0-9]{64}$/),
  blocks: z.array(
    z.object({
      id: z.string().regex(/^[a-f0-9]{64}$/),
      bytes: z.number().int().min(1).max(blockSize),
    }),
  ),
});

/** Content-addressed blocks avoid retaining another complete transcript for each appended message. */
export async function preserveRaw(
  root: string,
  file: string,
  directory: string,
  signal?: AbortSignal,
  name: 'raw' | 'events' = 'raw',
) {
  const objects = await ownedHistoryPath(root, 'objects');
  await fs.mkdir(objects, { recursive: true, mode: 0o700 });
  const input = await fs.open(file, 'r');
  const blocks: { id: string; bytes: number }[] = [];
  const full = createHash('sha256');
  let size = 0;
  try {
    const length = (await input.stat()).size;
    while (size < length) {
      signal?.throwIfAborted();
      const buffer = Buffer.alloc(Math.min(blockSize, length - size));
      let read = 0;
      while (read < buffer.length) {
        const { bytesRead } = await input.read(buffer, read, buffer.length - read, size + read);
        if (!bytesRead) throw new HubError('Captured history changed while preserving blocks.');
        read += bytesRead;
      }
      const id = digest(buffer);
      const target = await ownedHistoryPath(root, 'objects', id);
      let output: fs.FileHandle | undefined;
      const temporary = path.join(objects, `block-${randomBytes(12).toString('hex')}.tmp`);
      try {
        output = await fs.open(temporary, 'wx', 0o600);
        await output.writeFile(buffer);
        await output.sync();
        await fs.link(temporary, target);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        if (digest(await fs.readFile(target)) !== id)
          throw new HubError('Archive block failed its integrity check.');
      } finally {
        await output?.close();
        await fs.rm(temporary, { force: true });
      }
      blocks.push({ id, bytes: buffer.length });
      full.update(buffer);
      size += buffer.length;
    }
  } finally {
    await input.close();
  }
  const value = { version: 1, size, digest: full.digest('hex'), blocks };
  const output = await fs.open(path.join(directory, `${name}.json`), 'wx', 0o600);
  try {
    await output.writeFile(JSON.stringify(value));
    await output.sync();
  } finally {
    await output.close();
  }
  return value;
}
export async function rawDescriptor(
  root: string,
  chat: string,
  revision: string,
  name: 'raw' | 'events' = 'raw',
) {
  const file = await ownedHistoryPath(root, 'chats', chat, revision, `${name}.json`);
  try {
    const value = descriptor.parse(JSON.parse(await fs.readFile(file, 'utf8')));
    if (
      (name === 'raw' && value.digest !== revision) ||
      value.blocks.reduce((size, block) => size + block.bytes, 0) !== value.size
    )
      throw new Error();
    return value;
  } catch {
    throw new HubError('Preserved history descriptor failed its integrity check.');
  }
}
export async function* rawHistory(
  root: string,
  chat: string,
  revision: string,
  signal?: AbortSignal,
  name: 'raw' | 'events' = 'raw',
): AsyncGenerator<Buffer> {
  const value = await rawDescriptor(root, chat, revision, name);
  const full = createHash('sha256');
  for (const block of value.blocks) {
    signal?.throwIfAborted();
    const file = await ownedHistoryPath(root, 'objects', block.id);
    const buffer = await fs.readFile(file);
    if (buffer.length !== block.bytes || digest(buffer) !== block.id)
      throw new HubError('Preserved history block failed its integrity check.');
    full.update(buffer);
    yield buffer;
  }
  if (full.digest('hex') !== value.digest)
    throw new HubError('Preserved raw history failed its integrity check.');
}
export async function rawWindow(root: string, chat: string, revision: string, offset: number) {
  const result = await rawHistorySlice(root, chat, revision, offset, 64 * 1024);
  return {
    data: result.bytes.toString('base64'),
    size: result.size,
    offset,
    next: offset + result.bytes.length < result.size ? offset + result.bytes.length : null,
  };
}

/** Bounded verified random access; only intersecting blocks are read and checked in full. */
export async function rawHistorySlice(
  root: string,
  chat: string,
  revision: string,
  offset: number,
  length: number,
  name: 'raw' | 'events' = 'raw',
) {
  if (
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    !Number.isSafeInteger(length) ||
    length < 1 ||
    length > 8 * 1024 * 1024
  )
    throw new HubError('Invalid preserved history slice.');
  const value = await rawDescriptor(root, chat, revision, name);
  const pieces: Buffer[] = [];
  let position = 0,
    remaining = length;
  for (const block of value.blocks) {
    if (position + block.bytes > offset && remaining) {
      const buffer = await fs.readFile(await ownedHistoryPath(root, 'objects', block.id));
      if (buffer.length !== block.bytes || digest(buffer) !== block.id)
        throw new HubError('Preserved history block failed its integrity check.');
      const piece = buffer.subarray(
        Math.max(0, offset - position),
        Math.min(block.bytes, Math.max(0, offset - position) + remaining),
      );
      pieces.push(piece);
      remaining -= piece.length;
    }
    position += block.bytes;
  }
  return { bytes: Buffer.concat(pieces), size: value.size, offset };
}
