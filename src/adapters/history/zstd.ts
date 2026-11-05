import fs from 'node:fs/promises';
import { Decompress } from 'fzstd';
import { xxhashChecksum } from '../../shared/xxhash.js';

const ceiling = 64 * 1024 * 1024;
function boundedFrame(frame: Buffer) {
  const chunks: Buffer[] = [];
  let size = 0;
  const decoder = new Decompress((chunk) => {
    size += chunk.length;
    if (size > ceiling) throw new Error('Decompressed frame exceeds supported capacity.');
    chunks.push(Buffer.from(chunk));
  });
  decoder.push(frame, true);
  return Buffer.concat(chunks, size);
}
export interface FrameProgress {
  pending: boolean;
  bytes: number;
}

/** Validate frame boundaries, checksum and allocation bounds before decoding. Never repairs a source. */
export async function* zstdFrames(
  file: string,
  progress: FrameProgress,
  signal?: AbortSignal,
): AsyncGenerator<Buffer> {
  const handle = await fs.open(file, 'r');
  try {
    const size = (await handle.stat()).size;
    let offset = 0;
    async function read(start: number, count: number) {
      const value = Buffer.alloc(count);
      const { bytesRead } = await handle.read(value, 0, count, start);
      if (bytesRead !== count) return null;
      return value;
    }
    while (offset < size) {
      signal?.throwIfAborted();
      const header = await read(offset, Math.min(18, size - offset));
      if (!header || header.length < 6) {
        progress.pending = true;
        return;
      }
      if (header.readUInt32LE(0) !== 0xfd2fb528) throw new Error('Unsupported compressed frame.');
      const flags = header[4]!;
      if (flags & 0x18) throw new Error('Reserved frame flags.');
      const single = !!(flags & 32);
      const checksum = !!(flags & 4);
      const dictionary = [0, 1, 2, 4][flags & 3]!;
      const contentBytes = [single ? 1 : 0, 2, 4, 8][flags >> 6]!;
      let pos = 5 + (single ? 0 : 1) + dictionary;
      if (header.length < pos + contentBytes) {
        progress.pending = true;
        return;
      }
      if (dictionary && header.subarray(pos - dictionary, pos).some((value) => value !== 0))
        throw new Error('External compression dictionary is unsupported.');
      let contentSize = 0n;
      for (let i = 0; i < contentBytes; i++)
        contentSize |= BigInt(header[pos + i]!) << BigInt(i * 8);
      if (contentBytes === 2) contentSize += 256n;
      const window = single
        ? Number(contentSize)
        : 2 ** (10 + (header[5]! >> 3)) * (1 + (header[5]! & 7) / 8);
      if (window > ceiling || contentSize > BigInt(ceiling))
        throw new Error('Compressed frame exceeds supported decode capacity.');
      pos += contentBytes;
      let last = false;
      while (!last) {
        const block = await read(offset + pos, 3);
        if (!block) {
          progress.pending = true;
          return;
        }
        const bits = block.readUIntLE(0, 3);
        last = !!(bits & 1);
        const type = (bits >> 1) & 3;
        if (type === 3) throw new Error('Invalid compressed block.');
        pos += 3 + (type === 1 ? 1 : bits >> 3);
        if (pos > ceiling) throw new Error('Compressed frame exceeds supported decode capacity.');
      }
      const length = pos + (checksum ? 4 : 0);
      if (offset + length > size) {
        progress.pending = true;
        return;
      }
      const frame = (await read(offset, length))!;
      const plain = boundedFrame(frame);
      if (plain.length > ceiling || (contentBytes && BigInt(plain.length) !== contentSize))
        throw new Error('Invalid decompressed size.');
      if (checksum && xxhashChecksum(plain) !== frame.readUInt32LE(length - 4))
        throw new Error('Compressed checksum mismatch.');
      offset += length;
      progress.bytes = offset;
      yield plain;
    }
  } finally {
    await handle.close();
  }
}
