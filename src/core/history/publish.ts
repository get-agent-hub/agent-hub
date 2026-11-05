import fs from 'node:fs/promises';
import path from 'node:path';
import type { HistoryChat } from '../../contracts/history.js';
import { snapshot, writeChecked } from '../../shared/file-store.js';
import { rawHistory } from './raw.js';
import { ownedHistoryPath } from './storage.js';

/** A checked raw revision is immutable; projections and newly available assets may be repaired. */
export async function publishHistoryGeneration(
  root: string,
  staging: string,
  destination: string,
  chat: HistoryChat,
) {
  try {
    await fs.rename(staging, destination);
    return;
  } catch (error) {
    if (!['EEXIST', 'ENOTEMPTY'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
  }
  for await (const _chunk of rawHistory(root, chat.id, chat.revision)) {
    /* Verify every reused raw block. */
  }
  for (const asset of chat.assets.filter((item) => item.status === 'preserved')) {
    const directory = await ownedHistoryPath(root, 'chats', chat.id, chat.revision, 'assets');
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    const target = await ownedHistoryPath(
      root,
      'chats',
      chat.id,
      chat.revision,
      'assets',
      asset.id,
    );
    await fs.rename(path.join(staging, 'assets', asset.id), target);
  }
  for (const name of ['events.json', 'manifest.json']) {
    const target = await ownedHistoryPath(root, 'chats', chat.id, chat.revision, name);
    await writeChecked(await snapshot(target), await fs.readFile(path.join(staging, name), 'utf8'));
  }
}
