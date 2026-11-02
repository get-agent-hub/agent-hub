import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomBytes } from 'node:crypto';
import { HubError } from './errors.js';
import { snapshot, readOptionalText, writeAtomic, type FileSnapshot } from './file-store.js';
import { copyTree, inspectTree, type TreeSnapshot } from './recovery-tree.js';
import { recoveryRoot } from './recovery-paths.js';
import { hash } from './values.js';
import type { HubOrigin } from './hub-lock.js';
import type { FileChange } from './file-transaction.js';

export interface BaselineTarget {
  file: string;
  client: string;
  installed?: boolean;
}
export interface OriginalFile extends Omit<FileSnapshot, 'content'> {
  client: string;
  payload: string | null;
  hash: string;
  missingParents?: string[];
}
export interface Baseline {
  version: 1;
  root: string;
  capturedAt: string;
  scope: 'before-hub-creation' | 'existing-hub-checkpoint';
  hub: TreeSnapshot;
  files: OriginalFile[];
}
export interface ExpectedWrites {
  version: 1;
  files: Record<string, { hashes: string[]; modes: number[] }>;
}
const inside = (root: string, file: string) => {
  const relative = path.relative(root, file);
  return (
    relative === '' ||
    (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))
  );
};
export const baselineDirectory = (root: string) => path.join(recoveryRoot(root), 'baseline');

export async function readBaseline(root: string): Promise<Baseline | null> {
  const text = await readOptionalText(path.join(baselineDirectory(root), 'manifest.json'));
  if (text === null) return null;
  try {
    const doc = JSON.parse(text) as Baseline;
    if (
      doc.version !== 1 ||
      doc.root !== path.resolve(root) ||
      !Array.isArray(doc.files) ||
      !doc.hub ||
      typeof doc.hub.exists !== 'boolean' ||
      !Number.isInteger(doc.hub.mode) ||
      doc.hub.mode < 0 ||
      doc.hub.mode > 0o777 ||
      !Array.isArray(doc.hub.entries) ||
      !Number.isFinite(Date.parse(doc.capturedAt)) ||
      !/^[a-f0-9]{64}$/.test(doc.hub.fingerprint) ||
      !['before-hub-creation', 'existing-hub-checkpoint'].includes(doc.scope)
    )
      throw new Error();
    const names = new Set<string>();
    for (const file of doc.files) {
      if (
        !path.isAbsolute(file.file) ||
        !path.isAbsolute(file.realFile) ||
        !Number.isInteger(file.mode) ||
        file.mode < 0 ||
        file.mode > 0o777 ||
        !/^[a-f0-9]{64}$/.test(file.hash) ||
        (file.payload !== null && !/^file-[a-f0-9]+\.txt$/.test(file.payload)) ||
        names.has(file.file)
      )
        throw new Error();
      if (
        file.missingParents !== undefined &&
        (!Array.isArray(file.missingParents) ||
          file.missingParents.some(
            (directory) =>
              typeof directory !== 'string' ||
              !path.isAbsolute(directory) ||
              directory === path.parse(directory).root ||
              !inside(directory, file.realFile) ||
              directory === file.realFile,
          ))
      )
        throw new Error();
      names.add(file.file);
    }
    return doc;
  } catch {
    throw new HubError('Baseline metadata is invalid. Original data was not changed.');
  }
}

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
  const realRoot = await fs.realpath(root);
  for (const target of targets) {
    if (target.installed === false || files.some((file) => file.file === path.resolve(target.file)))
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
  const staging = await fs.mkdtemp(path.join(recoveryRoot(root), '.baseline-'));
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

export async function readExpectedWrites(root: string): Promise<ExpectedWrites> {
  const text = await readOptionalText(path.join(recoveryRoot(root), 'expected.json'));
  if (text === null) return { version: 1, files: {} };
  try {
    const doc = JSON.parse(text) as ExpectedWrites;
    if (
      doc.version !== 1 ||
      !doc.files ||
      typeof doc.files !== 'object' ||
      Array.isArray(doc.files) ||
      Object.values(doc.files).some(
        (entry) =>
          !entry ||
          !Array.isArray(entry.hashes) ||
          entry.hashes.some(
            (value) => typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value),
          ) ||
          !Array.isArray(entry.modes) ||
          entry.modes.some((value) => !Number.isInteger(value) || value < 0 || value > 0o777),
      )
    )
      throw new Error();
    return doc;
  } catch {
    throw new HubError('Recovery write journal is invalid.');
  }
}

/** Durable intent permits recovery from either side of a partially completed write. */
export async function recordExpectedWrites(root: string, changes: FileChange[]): Promise<void> {
  const expected = await readExpectedWrites(root);
  for (const change of changes)
    Object.defineProperty(expected.files, path.resolve(change.before.file), {
      value: {
        hashes: [...new Set([hash(change.before.content), hash(change.after)])],
        modes: [change.before.mode],
      },
      enumerable: true,
      configurable: true,
      writable: true,
    });
  await writeAtomic(
    path.join(recoveryRoot(root), 'expected.json'),
    JSON.stringify(expected, null, 2) + '\n',
    0o600,
  );
}
