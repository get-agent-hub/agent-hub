import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { HubError } from './errors.js';
import { copyTree, fileHash, inspectTree } from './recovery-tree.js';
import { hash, stableStringify } from './values.js';

export interface ArtifactSnapshot {
  path: string;
  /** Canonical parent, without following the final symlink. */
  physicalPath: string;
  kind: 'missing' | 'file' | 'directory' | 'symlink';
  mode: number;
  fingerprint: string;
  target?: string;
}
export const missingArtifactFingerprint = hash('missing-artifact');

export const containsPath = (parent: string, child: string): boolean => {
  const relative = path.relative(parent, child);
  return (
    relative === '' ||
    (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`))
  );
};

async function canonicalPath(file: string): Promise<string> {
  let parent = path.dirname(file);
  let suffix = path.basename(file);
  while (true) {
    try {
      return path.join(await fs.realpath(parent), suffix);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || parent === path.dirname(parent))
        throw new HubError(`Cannot resolve artifact parent: ${file}.`);
      try {
        if ((await fs.lstat(parent)).isSymbolicLink())
          throw new HubError(`Dangling parent symlink: ${parent}.`);
      } catch (nested) {
        if ((nested as NodeJS.ErrnoException).code !== 'ENOENT') throw nested;
      }
      suffix = path.join(path.basename(parent), suffix);
      parent = path.dirname(parent);
    }
  }
}

export async function inspectArtifact(file: string): Promise<ArtifactSnapshot> {
  file = path.resolve(file);
  const physicalPath = await canonicalPath(file);
  let stat;
  try {
    stat = await fs.lstat(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
      throw new HubError(`Cannot inspect artifact: ${file}.`);
    return {
      path: file,
      physicalPath,
      kind: 'missing',
      mode: 0,
      fingerprint: missingArtifactFingerprint,
    };
  }
  const mode = stat.mode & 0o777;
  if (stat.isSymbolicLink()) {
    const target = await fs.readlink(file);
    // Symlink permission bits differ by platform/umask and do not control target access.
    const linkMode = 0o777;
    return {
      path: file,
      physicalPath,
      kind: 'symlink',
      mode: linkMode,
      target,
      fingerprint: hash(stableStringify({ kind: 'symlink', mode: linkMode, target })),
    };
  }
  const kind = stat.isDirectory() ? 'directory' : stat.isFile() ? 'file' : undefined;
  if (!kind) throw new HubError(`Special files cannot be managed: ${file}.`);
  const content =
    kind === 'directory'
      ? (await inspectTree(file, false, false)).fingerprint
      : await fileHash(file);
  return {
    path: file,
    physicalPath,
    kind,
    mode,
    fingerprint: hash(stableStringify({ kind, mode, content })),
  };
}

export function sameArtifact(left: ArtifactSnapshot, right: ArtifactSnapshot): boolean {
  return left.physicalPath === right.physicalPath && left.fingerprint === right.fingerprint;
}

/** Copies the node itself; nested and final symlinks are not dereferenced. */
export async function copyArtifact(source: string, destination: string): Promise<void> {
  const before = await inspectArtifact(source);
  if (before.kind === 'missing') throw new HubError('An artifact source disappeared.');
  if (
    before.kind === 'directory' &&
    containsPath(before.physicalPath, (await inspectArtifact(destination)).physicalPath)
  )
    throw new HubError('Cannot copy a directory into itself or one of its descendants.');
  if (before.kind === 'directory') await copyTree(source, destination, false, false);
  else if (before.kind === 'symlink') await fs.symlink(before.target!, destination);
  else {
    await fs.copyFile(source, destination, fs.constants.COPYFILE_EXCL);
    await fs.chmod(destination, before.mode);
  }
  const after = await inspectArtifact(destination);
  if (
    before.fingerprint !== after.fingerprint ||
    !sameArtifact(before, await inspectArtifact(source))
  )
    throw new HubError('Artifact changed while copying. Retry without concurrent edits.');
}

export async function assertArtifact(before: ArtifactSnapshot): Promise<void> {
  if (!sameArtifact(before, await inspectArtifact(before.path)))
    throw new HubError(`Artifact changed since preview: ${before.path}. Review a new plan.`);
}

/** Replaces one node using same-directory staging; directory swaps have a brief rename gap. */
export async function replaceArtifact(
  before: ArtifactSnapshot,
  source: string | null,
): Promise<void> {
  await assertArtifact(before);
  const parent = path.dirname(before.physicalPath);
  await fs.mkdir(parent, { recursive: true, mode: 0o700 });
  const token = randomBytes(8).toString('hex');
  const staged = path.join(parent, `.agent-hub-${token}.new`);
  const held = path.join(parent, `.agent-hub-${token}.old`);
  let moved = false;
  let installed: ArtifactSnapshot | undefined;
  try {
    if (source) await copyArtifact(source, staged);
    await assertArtifact(before);
    if (before.kind !== 'missing') {
      await fs.rename(before.physicalPath, held);
      moved = true;
    }
    if (source) {
      if ((await inspectArtifact(before.path)).kind !== 'missing')
        throw new HubError('An external writer created the target during replacement.');
      await fs.rename(staged, before.physicalPath);
      installed = await inspectArtifact(before.path);
    }
    if (moved) await fs.rm(held, { recursive: true }).catch(() => undefined);
  } catch (error) {
    if (moved) {
      try {
        const current = await inspectArtifact(before.path);
        if (installed) {
          if (!sameArtifact(installed, current))
            throw new Error('An external edit prevents rollback.', { cause: error });
          await fs.rm(before.physicalPath, { recursive: true });
        } else if (current.kind !== 'missing')
          throw new Error('An external writer filled the target.', { cause: error });
        await fs.rename(held, before.physicalPath);
      } catch {
        throw new HubError(
          `Artifact replacement needs manual recovery. Original retained at ${held}.`,
          { cause: error },
        );
      }
    }
    throw error;
  } finally {
    await fs.rm(staged, { recursive: true, force: true });
  }
}

export interface ArtifactChange {
  before: ArtifactSnapshot;
  source: string | null;
  afterFingerprint: string;
  rollbackSource: string | null;
}

/** Rechecks every input and compensates completed replacements on failure. */
export async function writeArtifactTransaction(
  changes: ArtifactChange[],
  write = replaceArtifact,
  guard?: () => Promise<void>,
  finalize?: () => Promise<void>,
): Promise<void> {
  for (const [index, change] of changes.entries()) {
    await assertArtifact(change.before);
    for (const other of changes.slice(0, index))
      if (
        containsPath(other.before.physicalPath, change.before.physicalPath) ||
        containsPath(change.before.physicalPath, other.before.physicalPath)
      )
        throw new HubError('Artifact targets overlap. Separate their paths before applying.');
    if (
      change.source &&
      (await inspectArtifact(change.source)).fingerprint !== change.afterFingerprint
    )
      throw new HubError('Prepared artifact failed its integrity check.');
  }
  const written: ArtifactChange[] = [];
  try {
    for (const change of changes) {
      await guard?.();
      await write(change.before, change.source);
      written.push(change);
    }
    await guard?.();
    await finalize?.();
  } catch (error) {
    const failed: string[] = [];
    for (const change of written.reverse()) {
      try {
        const current = await inspectArtifact(change.before.path);
        if (
          current.physicalPath !== change.before.physicalPath ||
          current.fingerprint !== change.afterFingerprint
        )
          throw new Error('The artifact changed after replacement.', { cause: error });
        await write(current, change.rollbackSource);
      } catch {
        failed.push(change.before.path);
      }
    }
    if (failed.length)
      throw new HubError(`Artifact rollback requires manual review: ${failed.join(', ')}.`, {
        cause: error,
      });
    throw new HubError('Artifact update failed; completed changes were rolled back.', {
      cause: error,
    });
  }
}
