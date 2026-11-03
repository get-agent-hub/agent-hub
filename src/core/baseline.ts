import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomBytes } from 'node:crypto';
import { HubError } from './errors.js';
import { snapshot, writeAtomic } from './file-store.js';
import { copyTree, inspectTree, type TreeSnapshot } from './recovery-tree.js';
import { recoveryStorage, mirrorRecovery } from './recovery-storage.js';
import { hash } from './values.js';
import type { HubOrigin } from './hub-lock.js';
import type { FileChange } from './file-transaction.js';
import { readArtifactBaseline, recordArtifactFileWrites } from './artifact-recovery.js';
import {
  baselineDirectory,
  readBaseline,
  type Baseline,
  type OriginalFile,
} from './recovery-baseline-store.js';
import { recordFileIntents } from './recovery-file-intents.js';
export {
  baselineDirectory,
  readBaseline,
  type Baseline,
  type OriginalFile,
} from './recovery-baseline-store.js';
export { readExpectedWrites, type ExpectedWrites } from './recovery-file-intents.js';

export interface BaselineTarget {
  file: string;
  client: string;
  installed?: boolean;
}
const inside = (root: string, file: string) => {
  const relative = path.relative(root, file);
  return (
    relative === '' ||
    (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))
  );
};
export async function originalContent(root: string, file: OriginalFile): Promise<string | null> {
  const content =
    file.payload === null
      ? null
      : await fs.readFile(path.join(baselineDirectory(root), file.payload), 'utf8');
  if (hash(content) !== file.hash) throw new HubError('Baseline file failed its integrity check.');
  return content;
}

export async function verifyBaseline(root: string, baseline: Baseline): Promise<void> {
  if (
    baseline.hub.exists &&
    (await inspectTree(path.join(baselineDirectory(root), 'hub'))).fingerprint !==
      baseline.hub.fingerprint
  )
    throw new HubError('Baseline hub archive failed its integrity check.');
  for (const file of baseline.files) await originalContent(root, file);
}

async function captureFiles(
  directory: string,
  root: string,
  targets: BaselineTarget[],
  existing: OriginalFile[],
): Promise<OriginalFile[]> {
  const files = [...existing];
  const artifacts = await readArtifactBaseline(root);
  const realRoot = await fs.realpath(root).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return path.resolve(root);
    throw error;
  });
  for (const target of targets) {
    if (
      target.installed === false ||
      files.some((file) => file.file === path.resolve(target.file)) ||
      artifacts.entries.some((entry) => entry.before.path === path.resolve(target.file))
    )
      continue;
    const before = await snapshot(path.resolve(target.file));
    // Ordinary hub files are restored by the complete tree; external symlink targets need their own original.
    if (inside(root, before.file) && inside(realRoot, before.realFile)) continue;
    const payload = before.content === null ? null : `file-${randomBytes(12).toString('hex')}.txt`;
    if (payload)
      await fs.writeFile(path.join(directory, payload), before.content!, {
        mode: 0o600,
        flag: 'wx',
      });
    const missingParents: string[] = [];
    let parent = path.dirname(before.realFile);
    while (true) {
      try {
        await fs.lstat(parent);
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        missingParents.push(parent);
        parent = path.dirname(parent);
      }
    }
    const { content, ...metadata } = before;
    files.push({
      ...metadata,
      client: target.client,
      payload,
      hash: hash(content),
      missingParents,
    });
  }
  return files;
}

/** Called while holding the hub lock and before the first managed write. Never replaces originals. */
export async function ensureBaseline(
  root: string,
  targets: BaselineTarget[],
  origin: HubOrigin,
): Promise<Baseline> {
  await mirrorRecovery(root, () => ensureBaseline(root, targets, origin));
  root = path.resolve(root);
  if (root === path.parse(root).root || root === os.homedir())
    throw new HubError('The filesystem root or home directory cannot be used as the hub.');
  const externalHubFiles = [
    'hub.yaml',
    '.env',
    '.gitignore',
    'mcp/servers.yaml',
    'state/imported-definitions.json',
    'state/sync.json',
    'state/doctor.json',
  ].map((file) => ({ file: path.join(root, file), client: 'hub' }));
  const allTargets = [...targets, ...externalHubFiles];
  const directory = baselineDirectory(root);
  let baseline = await readBaseline(root);
  if (baseline) {
    await verifyBaseline(root, baseline);
    const files = await captureFiles(directory, root, allTargets, baseline.files);
    if (files.length !== baseline.files.length) {
      baseline = { ...baseline, files };
      await writeAtomic(
        path.join(directory, 'manifest.json'),
        JSON.stringify(baseline, null, 2) + '\n',
        0o600,
      );
    }
    return baseline;
  }
  const staging = await fs.mkdtemp(path.join(recoveryStorage(root), '.baseline-'));
  try {
    const hub: TreeSnapshot = origin.rootExisted
      ? await inspectTree(root, !origin.stateExisted)
      : { exists: false, mode: 0, entries: [], fingerprint: hash('missing-directory') };
    if (hub.exists) {
      await copyTree(root, path.join(staging, 'hub'), !origin.stateExisted);
      if (
        (await inspectTree(path.join(staging, 'hub'))).fingerprint !== hub.fingerprint ||
        (await inspectTree(root, !origin.stateExisted)).fingerprint !== hub.fingerprint
      )
        throw new HubError(
          'Hub changed while capturing its original state. Retry without concurrent edits.',
        );
    }
    const files = await captureFiles(staging, root, allTargets, []);
    baseline = {
      version: 1,
      root,
      capturedAt: new Date().toISOString(),
      scope: hub.exists ? 'existing-hub-checkpoint' : 'before-hub-creation',
      hub,
      files,
    };
    await fs.writeFile(
      path.join(staging, 'manifest.json'),
      JSON.stringify(baseline, null, 2) + '\n',
      { flag: 'wx', mode: 0o600 },
    );
    await fs.rename(staging, directory);
    return baseline;
  } finally {
    await fs.rm(staging, { recursive: true, force: true });
  }
}

/** Durable intent permits recovery from either side of a partially completed write. */
export async function recordExpectedWrites(root: string, changes: FileChange[]): Promise<void> {
  await mirrorRecovery(root, () => recordExpectedWrites(root, changes));
  await recordFileIntents(root, changes);
  await recordArtifactFileWrites(root, changes);
}
