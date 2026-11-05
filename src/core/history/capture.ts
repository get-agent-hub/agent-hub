import { createHash, randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { HistoryFile } from '../../contracts/history.js';
import { HubError } from '../../shared/errors.js';
import { ownedHistoryPath } from './storage.js';
export const sourceStamp = (stat: {
  dev: bigint;
  ino: bigint;
  size: bigint;
  mtimeNs: bigint;
  ctimeNs: bigint;
}) => [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].join(':');

export async function captureHistory(root: string, source: HistoryFile, signal?: AbortSignal) {
  const base = await fs.realpath(source.source.root);
  const physical = await fs.realpath(source.file);
  if (!physical.startsWith(base + path.sep) || (await fs.lstat(source.file)).isSymbolicLink())
    throw new HubError('Session source escaped its selected store.');
  const directory = await ownedHistoryPath(root, 'staging');
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const file = path.join(directory, randomBytes(16).toString('hex'));
  const input = await fs.open(source.file, constants.O_RDONLY | constants.O_NOFOLLOW);
  let output: fs.FileHandle | undefined;
  try {
    const before = await input.stat();
    const initialStamp = sourceStamp(await input.stat({ bigint: true }));
    if (!before.isFile()) throw new HubError('Session source is not a regular file.');
    output = await fs.open(file, 'wx', 0o600);
    const digest = createHash('sha256');
    const buffer = Buffer.alloc(64 * 1024);
    let offset = 0;
    while (offset < before.size) {
      signal?.throwIfAborted();
      const { bytesRead } = await input.read(
        buffer,
        0,
        Math.min(buffer.length, before.size - offset),
        offset,
      );
      if (!bytesRead) throw new HubError('Session source was truncated during capture.');
      const chunk = buffer.subarray(0, bytesRead);
      digest.update(chunk);
      await output.writeFile(chunk);
      offset += bytesRead;
    }
    const revision = digest.digest('hex');
    // Rehash the captured prefix: appends are allowed, same-size rewrites are not.
    const verify = createHash('sha256');
    for (offset = 0; offset < before.size;) {
      signal?.throwIfAborted();
      const { bytesRead } = await input.read(
        buffer,
        0,
        Math.min(buffer.length, before.size - offset),
        offset,
      );
      if (!bytesRead) throw new HubError('Session source changed during capture.');
      verify.update(buffer.subarray(0, bytesRead));
      offset += bytesRead;
    }
    const after = await fs.stat(source.file);
    if (
      after.ino !== before.ino ||
      after.dev !== before.dev ||
      verify.digest('hex') !== revision ||
      (await fs.realpath(source.file)) !== physical
    )
      throw new HubError('Session source changed during capture. Retry the scan.');
    await output.sync();
    const finalStamp = sourceStamp(await input.stat({ bigint: true }));
    return {
      file,
      revision,
      bytes: before.size,
      sourceStamp: finalStamp === initialStamp ? initialStamp : undefined,
    };
  } catch (error) {
    await fs.rm(file, { force: true });
    throw error;
  } finally {
    await output?.close();
    await input.close();
  }
}
