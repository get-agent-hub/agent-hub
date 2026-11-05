import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { HistoryAsset } from '../../contracts/history.js';
import { hash } from '../../shared/values.js';

/** Only explicit local references within the selected store are eligible; no arbitrary project file reads. */
export async function preserveHistoryAssets(
  references: Set<string>,
  sourceRoot: string,
  sourceFile: string,
  destination: string,
  signal?: AbortSignal,
): Promise<HistoryAsset[]> {
  const assets: HistoryAsset[] = [];
  const root = await fs.realpath(sourceRoot);
  for (const reference of references) {
    signal?.throwIfAborted();
    const asset: HistoryAsset = {
      id: hash(reference),
      reference: reference.startsWith('data:') ? 'Embedded data in native event' : reference,
      status: 'missing',
    };
    assets.push(asset);
    if (/^data:/i.test(reference)) {
      asset.status = 'embedded';
      continue;
    }
    if (/^https?:/i.test(reference)) {
      asset.status = 'remote';
      try {
        const url = new URL(reference);
        url.username = '';
        url.password = '';
        url.search = '';
        url.hash = '';
        asset.reference = url.toString();
      } catch {
        asset.reference = 'Remote attachment';
      }
      continue;
    }
    if (/^[a-z]+:/i.test(reference) && !reference.startsWith('file:')) {
      asset.status = 'outside-source';
      continue;
    }
    try {
      const native = reference.startsWith('file:')
        ? fileURLToPath(reference)
        : path.resolve(path.dirname(sourceFile), reference);
      const physical = await fs.realpath(native);
      if (!physical.startsWith(root + path.sep)) {
        asset.status = 'outside-source';
        continue;
      }
      const input = await fs.open(physical, constants.O_RDONLY | constants.O_NOFOLLOW);
      const target = path.join(destination, asset.id);
      let output: fs.FileHandle | undefined;
      try {
        const before = await input.stat();
        if (!before.isFile()) continue;
        await fs.mkdir(destination, { recursive: true, mode: 0o700 });
        output = await fs.open(target, 'wx', 0o600);
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
          if (!bytesRead) throw new Error('Asset truncated.');
          await output.writeFile(buffer.subarray(0, bytesRead));
          digest.update(buffer.subarray(0, bytesRead));
          offset += bytesRead;
        }
        const after = await input.stat();
        if (
          after.size !== before.size ||
          after.mtimeMs !== before.mtimeMs ||
          after.ctimeMs !== before.ctimeMs
        )
          throw new Error('Asset changed.');
        await output.sync();
        asset.status = 'preserved';
        asset.digest = digest.digest('hex');
        asset.bytes = offset;
      } finally {
        await output?.close();
        await input.close();
      }
      if (asset.status !== 'preserved') await fs.rm(target, { force: true });
    } catch {
      signal?.throwIfAborted();
    }
  }
  return assets;
}
