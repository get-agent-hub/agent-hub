import { createHash } from 'node:crypto';
import { constants, createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { HubError } from './errors.js';
import { hash, stableStringify } from './values.js';

interface TreeEntry {
  path: string;
  kind: 'file' | 'directory' | 'symlink';
  mode: number;
  hash?: string;
  target?: string;
}
export interface TreeSnapshot {
  exists: boolean;
  mode: number;
  entries: TreeEntry[];
  fingerprint: string;
}
const skipped = (relative: string, excludeState: boolean) =>
  relative === path.join('state', 'sync.lock') ||
  (excludeState && (relative === 'state' || relative.startsWith('state' + path.sep)));

export async function fileHash(file: string): Promise<string> {
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(file)) digest.update(chunk);
  return digest.digest('hex');
}

export async function inspectTree(
  root: string,
  excludeState = false,
  excludeLock = true,
): Promise<TreeSnapshot> {
  let rootStat;
  try {
    rootStat = await fs.lstat(root);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return { exists: false, mode: 0, entries: [], fingerprint: hash('missing-directory') };
  }
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink())
    throw new HubError('Recovery requires a real hub directory, not a file or directory symlink.');
  const entries: TreeEntry[] = [];
  async function walk(directory: string): Promise<void> {
    for (const name of (await fs.readdir(directory)).sort()) {
      const file = path.join(directory, name);
      const relative = path.relative(root, file);
      if (excludeLock && skipped(relative, excludeState)) continue;
      const stat = await fs.lstat(file);
      const mode = stat.mode & 0o777;
      if (stat.isSymbolicLink())
        entries.push({ path: relative, kind: 'symlink', mode, target: await fs.readlink(file) });
      else if (stat.isDirectory()) {
        entries.push({ path: relative, kind: 'directory', mode });
        await walk(file);
      } else if (stat.isFile())
        entries.push({
          path: relative,
          kind: 'file',
          mode,
          hash: await fileHash(file),
        });
      else throw new HubError('A special file in the hub prevents a complete recovery snapshot.');
    }
  }
  await walk(root);
  const mode = rootStat.mode & 0o777;
  return { exists: true, mode, entries, fingerprint: hash(stableStringify({ mode, entries })) };
}

export async function copyTree(
  source: string,
  destination: string,
  excludeState = false,
  excludeLock = true,
): Promise<void> {
  const tree = await inspectTree(source, excludeState, excludeLock);
  if (!tree.exists) throw new HubError('The original directory is missing.');
  await fs.mkdir(destination, { mode: 0o700 });
  const directories = tree.entries.filter((entry) => entry.kind === 'directory');
  for (const entry of directories)
    await fs.mkdir(path.join(destination, entry.path), { recursive: true, mode: 0o700 });
  for (const entry of tree.entries) {
    const output = path.join(destination, entry.path);
    const input = path.join(source, entry.path);
    if (entry.kind === 'file') {
      await fs.copyFile(input, output, constants.COPYFILE_EXCL);
      await fs.chmod(output, entry.mode);
      const stat = await fs.stat(input);
      await fs.utimes(output, stat.atime, stat.mtime);
    } else if (entry.kind === 'symlink') {
      await fs.symlink(entry.target!, output);
      // macOS applies umask to link modes. Preserve existing snapshot fingerprints
      // without following the link or changing permissions on its target.
      if (((await fs.lstat(output)).mode & 0o777) !== entry.mode)
        await fs.lchmod(output, entry.mode);
    }
  }
  for (const entry of directories.reverse())
    await fs.chmod(path.join(destination, entry.path), entry.mode);
  await fs.chmod(destination, tree.mode);
}
