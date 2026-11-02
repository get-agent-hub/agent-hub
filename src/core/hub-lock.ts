import fs from 'node:fs/promises';
import path from 'node:path';
import { HubError } from './errors.js';
import { snapshot, writeChecked, readOptionalText, type FileSnapshot } from './file-store.js';
import { recoveryRoot } from './recovery-paths.js';

export interface HubOrigin {
  version: 1;
  root: string;
  rootExisted: boolean;
  stateExisted: boolean;
  recordedAt: string;
}
export interface LockInfo {
  file: string;
  status: 'absent' | 'active' | 'stale' | 'unknown';
  pid?: number;
  snapshot: FileSnapshot;
}

export const lockPaths = (root: string): string[] => [
  path.join(recoveryRoot(root), 'operation.lock'),
  path.join(root, 'state', 'sync.lock'),
];

export async function inspectLocks(root: string): Promise<LockInfo[]> {
  return Promise.all(
    lockPaths(root).map(async (file) => {
      const before = await snapshot(file);
      if (before.content === null) return { file, status: 'absent', snapshot: before };
      const text = before.content.trim();
      const pid = /^\d+$/.test(text) ? Number(text) : NaN;
      if (!Number.isSafeInteger(pid) || pid <= 0)
        return { file, status: 'unknown', snapshot: before };
      try {
        process.kill(pid, 0);
        return { file, status: 'active', pid, snapshot: before };
      } catch (error) {
        return {
          file,
          status: (error as NodeJS.ErrnoException).code === 'ESRCH' ? 'stale' : 'active',
          pid,
          snapshot: before,
        };
      }
    }),
  );
}

/** Explicit recovery never removes a lock belonging to a live or ambiguous owner. */
export async function recoverLocks(root: string): Promise<void> {
  const locks = await inspectLocks(root);
  if (locks.some((lock) => lock.status === 'active' || lock.status === 'unknown'))
    throw new HubError('A live or unrecognized lock prevents recovery.');
  for (const lock of locks)
    if (lock.status === 'stale') {
      const fresh = (await inspectLocks(root)).find((entry) => entry.file === lock.file)!;
      if (fresh.status !== 'stale' || fresh.snapshot.content !== lock.snapshot.content)
        throw new HubError('Lock changed during recovery. Review again.');
      await writeChecked(lock.snapshot, null);
    }
}

async function present(file: string): Promise<boolean> {
  try {
    await fs.lstat(file);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

async function acquire(file: string) {
  try {
    const handle = await fs.open(file, 'wx', 0o600);
    try {
      await handle.writeFile(String(process.pid));
      await handle.sync();
    } catch (error) {
      await handle.close();
      await fs.unlink(file);
      throw error;
    }
    return handle;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST')
      throw new HubError('Another hub update is running. Inspect the lock owner before recovery.');
    throw error;
  }
}

async function release(file: string, handle: fs.FileHandle): Promise<void> {
  const owned = await handle.stat();
  await handle.close();
  try {
    const current = await fs.stat(file);
    if (
      current.ino === owned.ino &&
      current.dev === owned.dev &&
      (await fs.readFile(file, 'utf8')) === String(process.pid)
    )
      await fs.unlink(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

/** The external lock survives a hub-directory reset; the inner lock coordinates older clients. */
export async function withHubLock<T>(
  root: string,
  action: (origin: HubOrigin) => Promise<T>,
  options: { createHub?: boolean } = {},
): Promise<T> {
  const recovery = recoveryRoot(root);
  await fs.mkdir(recovery, { recursive: true, mode: 0o700 });
  const recoveryStat = await fs.lstat(recovery);
  if (!recoveryStat.isDirectory() || recoveryStat.isSymbolicLink())
    throw new HubError('Recovery storage must be a real private directory, not a symlink.');
  const ownerFile = path.join(recovery, 'owner.json');
  if ((await readOptionalText(ownerFile)) === null) {
    if ((await fs.readdir(recovery)).length)
      throw new HubError(
        'The recovery path already contains unrecognized data. Choose a dedicated hub path; no existing recovery files were changed.',
      );
    try {
      await fs.writeFile(ownerFile, JSON.stringify({ version: 1, root: path.resolve(root) }), {
        flag: 'wx',
        mode: 0o600,
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
  }
  let owner;
  try {
    owner = JSON.parse((await readOptionalText(ownerFile))!);
  } catch {
    throw new HubError('Recovery storage ownership metadata is invalid.');
  }
  if (owner.version !== 1 || owner.root !== path.resolve(root))
    throw new HubError('Recovery storage belongs to a different hub.');
  await fs.chmod(recovery, 0o700);
  await fs.writeFile(path.join(recovery, '.gitignore'), '*\n', { mode: 0o600 });
  const [outerFile, innerFile] = lockPaths(root);
  const outer = await acquire(outerFile);
  try {
    const originFile = path.join(recovery, 'origin.json');
    const first: HubOrigin = {
      version: 1,
      root: path.resolve(root),
      rootExisted: await present(root),
      stateExisted: await present(path.join(root, 'state')),
      recordedAt: new Date().toISOString(),
    };
    try {
      await fs.writeFile(originFile, JSON.stringify(first), { flag: 'wx', mode: 0o600 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    const origin = JSON.parse(await fs.readFile(originFile, 'utf8')) as HubOrigin;
    if (
      origin.version !== 1 ||
      origin.root !== path.resolve(root) ||
      typeof origin.rootExisted !== 'boolean' ||
      typeof origin.stateExisted !== 'boolean'
    )
      throw new HubError('Recovery origin metadata is invalid.');
    if (options.createHub !== false)
      await fs.mkdir(path.dirname(innerFile), { recursive: true, mode: 0o700 });
    const inner = (await present(path.dirname(innerFile))) ? await acquire(innerFile) : undefined;
    try {
      return await action(origin);
    } finally {
      if (inner) await release(innerFile, inner);
    }
  } finally {
    await release(outerFile, outer);
  }
}
