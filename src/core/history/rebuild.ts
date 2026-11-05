import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { withHubLock } from '../../shared/hub-lock.js';
import { indexHistory } from './index.js';
import { preserveRaw, rawHistory } from './raw.js';
import { ownedHistoryPath, readHistory, revisionDirectory, writeHistory } from './storage.js';

/** Rebuild disposable projections without contacting or changing the original clients. */
export async function rebuildHistory(root: string, signal?: AbortSignal) {
  return withHubLock(root, async () => {
    const catalog = await readHistory(root);
    let rebuilt = 0;
    for (const chat of catalog.chats) {
      signal?.throwIfAborted();
      const directory = await revisionDirectory(root, chat.id, chat.revision);
      const temporary = await ownedHistoryPath(
        root,
        'staging',
        `rebuild-${randomBytes(8).toString('hex')}`,
      );
      await fs.mkdir(temporary, { recursive: true, mode: 0o700 });
      try {
        const file = path.join(temporary, 'raw');
        const output = await fs.open(file, 'wx', 0o600);
        try {
          for await (const chunk of rawHistory(root, chat.id, chat.revision, signal))
            await output.writeFile(chunk);
        } finally {
          await output.close();
        }
        const indexed = await indexHistory(
          file,
          path.join(temporary, 'events.jsonl'),
          chat.relative.endsWith('.zstd'),
          signal,
        );
        await preserveRaw(root, path.join(temporary, 'events.jsonl'), temporary, signal, 'events');
        await fs.rename(path.join(temporary, 'events.json'), path.join(directory, 'events.json'));
        Object.assign(chat, {
          events: indexed.events,
          indexedBytes: indexed.indexedBytes,
          content: indexed.content,
          issues: indexed.issues,
        });
        rebuilt++;
      } finally {
        await fs.rm(temporary, { recursive: true, force: true });
      }
    }
    await writeHistory(root, catalog);
    return { rebuilt };
  });
}
