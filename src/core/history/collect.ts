import fs from 'node:fs/promises';
import path from 'node:path';
import { ownedHistoryPath } from './storage.js';

/** Called under the Hub lock after explicit deletion. Unknown descriptors stop collection. */
export async function collectHistoryObjects(root: string) {
  const retained = new Set<string>();
  const chats = await ownedHistoryPath(root, 'chats');
  for (const chat of await fs.readdir(chats, { withFileTypes: true })) {
    if (chat.isSymbolicLink())
      throw new Error('Unknown archive binding prevents object collection.');
    if (!chat.isDirectory() || chat.isSymbolicLink()) continue;
    const directory = await ownedHistoryPath(root, 'chats', chat.name);
    for (const revision of await fs.readdir(directory, { withFileTypes: true })) {
      if (revision.isSymbolicLink())
        throw new Error('Unknown archive binding prevents object collection.');
      if (!revision.isDirectory() || revision.isSymbolicLink()) continue;
      for (const name of ['raw.json', 'events.json']) {
        const file = await ownedHistoryPath(root, 'chats', chat.name, revision.name, name);
        const value = JSON.parse(await fs.readFile(file, 'utf8')) as {
          version?: unknown;
          blocks?: { id?: unknown }[];
        };
        if (value.version !== 1 || !Array.isArray(value.blocks))
          throw new Error('Unknown archive descriptor.');
        for (const block of value.blocks) {
          if (typeof block.id !== 'string' || !/^[a-f0-9]{64}$/.test(block.id))
            throw new Error('Unknown archive block.');
          retained.add(block.id);
        }
      }
    }
  }
  const directory = await ownedHistoryPath(root, 'objects');
  let removed = 0;
  for (const file of await fs.readdir(directory, { withFileTypes: true })) {
    if (file.isFile() && /^[a-f0-9]{64}$/.test(file.name) && !retained.has(file.name)) {
      await fs.unlink(path.join(directory, file.name));
      removed++;
    }
  }
  return removed;
}
