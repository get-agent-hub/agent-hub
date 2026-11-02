import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { HubError } from './errors.js';

export interface FileSnapshot {
  file: string;
  realFile: string;
  content: string | null;
  mode: number;
}

export async function readOptionalText(file: string): Promise<string | null> {
  try {
    return await fs.readFile(file, 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new HubError(`Cannot read ${file}.`);
  }
}

export async function snapshot(file: string): Promise<FileSnapshot> {
  const content = await readOptionalText(file);
  if (content === null) {
    try {
      if ((await fs.lstat(file)).isSymbolicLink())
        throw new HubError(`Dangling config symlink: ${file}.`);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
    // An existing parent can itself be a symlink.
    let parent = path.dirname(file);
    let suffix = path.basename(file);
    while (true) {
      try {
        return {
          file,
          realFile: path.join(await fs.realpath(parent), suffix),
          content,
          mode: 0o600,
        };
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT' || path.dirname(parent) === parent)
          throw new HubError(`Cannot resolve ${file}.`);
        suffix = path.join(path.basename(parent), suffix);
        parent = path.dirname(parent);
      }
    }
  }
  const realFile = await fs.realpath(file);
  return { file, realFile, content, mode: (await fs.stat(realFile)).mode & 0o777 };
}

/** Atomic file replacement, guarded against changes since planning. */
export async function writeChecked(snap: FileSnapshot, next: string | null) {
  const current = await snapshot(snap.file);
  if (current.realFile !== snap.realFile || current.content !== snap.content)
    throw new HubError(`Configuration changed: ${snap.file}. Run a new dry run.`);
  if (next === null) {
    if (current.content !== null) await fs.unlink(snap.realFile);
    return;
  }
  await fs.mkdir(path.dirname(snap.realFile), { recursive: true, mode: 0o700 });
  const tmp = `${snap.realFile}.agent-hub-${randomBytes(8).toString('hex')}.tmp`;
  try {
    const handle = await fs.open(tmp, 'wx', snap.mode);
    try {
      await handle.writeFile(next, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    const latest = await snapshot(snap.file);
    if (latest.realFile !== snap.realFile || latest.content !== snap.content)
      throw new HubError(`Configuration changed: ${snap.file}. Run a new dry run.`);
    await fs.rename(tmp, snap.realFile);
  } finally {
    await fs.unlink(tmp).catch(() => undefined);
  }
}

export async function writeAtomic(file: string, content: string, mode?: number): Promise<void> {
  const before = await snapshot(file);
  await writeChecked({ ...before, mode: mode ?? before.mode }, content);
}
