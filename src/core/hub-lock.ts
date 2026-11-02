import fs from 'node:fs/promises';
import path from 'node:path';
import { HubError } from './errors.js';

/** One advisory lock for every operation that changes hub or client configuration. */
export async function withHubLock<T>(root: string, action: () => Promise<T>): Promise<T> {
  const directory = path.join(root, 'state');
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  // Keep the existing filename so older sync processes honor the same lock.
  const file = path.join(directory, 'sync.lock');
  let lock;
  try {
    lock = await fs.open(file, 'wx', 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new HubError(
        'Another hub update is running (state/sync.lock). If a process crashed, verify it has stopped before removing the lock.',
      );
    }
    throw error;
  }
  try {
    await lock.writeFile(String(process.pid));
    return await action();
  } finally {
    await lock.close();
    await fs.unlink(file);
  }
}
