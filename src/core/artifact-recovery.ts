import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { recoveryRoot } from './recovery-paths.js';
import { readOptionalText, writeAtomic } from './file-store.js';
import {
  containsPath,
  copyArtifact,
  inspectArtifact,
  sameArtifact,
  missingArtifactFingerprint,
  type ArtifactChange,
  type ArtifactSnapshot,
} from './artifacts.js';
import { HubError } from './errors.js';
import { readBaseline } from './recovery-baseline-store.js';
import { recordFileIntents, type FileIntent } from './recovery-file-intents.js';
import type { FileChange } from './file-transaction.js';
import { hash, stableStringify } from './values.js';

interface OriginalArtifact {
  before: ArtifactSnapshot;
  client: string;
  payload: string | null;
  missingParents: string[];
}
interface ArtifactBaseline {
  version: 1;
  root: string;
  entries: OriginalArtifact[];
}
const directory = (root: string) => path.join(recoveryRoot(root), 'artifacts');
const manifestFile = (root: string) => path.join(directory(root), 'manifest.json');
const intentsFile = (root: string) => path.join(directory(root), 'expected.json');
const digest = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

async function privateMetadata(root: string, file: string): Promise<string | null> {
  const dir = await inspectArtifact(directory(root));
  if (!['missing', 'directory'].includes(dir.kind))
    throw new HubError('Artifact recovery storage must be a real directory.');
  const metadata = await inspectArtifact(file);
  if (!['missing', 'file'].includes(metadata.kind))
    throw new HubError('Artifact recovery metadata must be a regular file.');
  return readOptionalText(file);
}

export async function readArtifactBaseline(root: string): Promise<ArtifactBaseline> {
  const text = await privateMetadata(root, manifestFile(root));
  if (text === null) return { version: 1, root: path.resolve(root), entries: [] };
  try {
    const doc = JSON.parse(text) as ArtifactBaseline;
    if (doc.version !== 1 || doc.root !== path.resolve(root) || !Array.isArray(doc.entries))
      throw new Error();
    const paths = new Set<string>();
    for (const entry of doc.entries) {
      if (
        !entry.before ||
        !path.isAbsolute(entry.before.path) ||
        !path.isAbsolute(entry.before.physicalPath) ||
        !digest(entry.before.fingerprint) ||
        !['missing', 'file', 'directory', 'symlink'].includes(entry.before.kind) ||
        typeof entry.client !== 'string' ||
        !Array.isArray(entry.missingParents) ||
        entry.missingParents.some(
          (parent) =>
            typeof parent !== 'string' ||
            !path.isAbsolute(parent) ||
            parent === path.parse(parent).root ||
            !containsPath(parent, entry.before.physicalPath) ||
            parent === entry.before.physicalPath,
        ) ||
        paths.has(entry.before.path) ||
        (entry.payload !== null && !/^original-[a-f0-9]+$/.test(entry.payload)) ||
        (entry.before.kind === 'missing') !== (entry.payload === null)
      )
        throw new Error();
      paths.add(entry.before.path);
      if (
        entry.payload &&
        (await inspectArtifact(path.join(directory(root), entry.payload))).fingerprint !==
          entry.before.fingerprint
      )
        throw new Error();
    }
    return doc;
  } catch {
    throw new HubError(
      'Artifact baseline failed validation or integrity checks. Original data was not changed.',
    );
  }
}

/** Append first-touch originals while holding the hub lock. Existing records are immutable. */
export async function ensureArtifactBaseline(
  root: string,
  targets: { before: ArtifactSnapshot; client: string }[],
): Promise<void> {
  const baseline = await readArtifactBaseline(root);
  const files = await readBaseline(root);
  const realRoot = await fs.realpath(root);
  const dir = directory(root);
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  let changed = false;
  for (const target of targets) {
    const before = target.before;
    if (
      containsPath(path.resolve(root), before.path) &&
      containsPath(realRoot, before.physicalPath)
    )
      continue;
    if (
      baseline.entries.some((entry) => entry.before.path === before.path) ||
      files?.files.some((entry) => entry.file === before.path)
    )
      continue;
    if (!sameArtifact(before, await inspectArtifact(before.path)))
      throw new HubError('Artifact changed before baseline capture.');
    for (const entry of baseline.entries)
      if (
        containsPath(entry.before.physicalPath, before.physicalPath) ||
        containsPath(before.physicalPath, entry.before.physicalPath)
      )
        throw new HubError('Original artifact paths overlap an existing recovery target.');
    const payload =
      before.kind === 'missing' ? null : `original-${randomBytes(12).toString('hex')}`;
    if (payload) await copyArtifact(before.path, path.join(dir, payload));
    const missingParents: string[] = [];
    let parent = path.dirname(before.physicalPath);
    while ((await inspectArtifact(parent)).kind === 'missing') {
      missingParents.push(parent);
      parent = path.dirname(parent);
    }
    baseline.entries.push({ before, client: target.client, payload, missingParents });
    changed = true;
  }
  if (changed)
    await writeAtomic(manifestFile(root), JSON.stringify(baseline, null, 2) + '\n', 0o600);
}

async function readIntents(root: string): Promise<Record<string, string[]>> {
  const text = await privateMetadata(root, intentsFile(root));
  if (text === null) return {};
  try {
    const values = JSON.parse(text) as Record<string, string[]>;
    if (
      !values ||
      typeof values !== 'object' ||
      Array.isArray(values) ||
      Object.entries(values).some(
        ([file, fingerprints]) =>
          !path.isAbsolute(file) ||
          !Array.isArray(fingerprints) ||
          fingerprints.some((fingerprint) => !digest(fingerprint)),
      )
    )
      throw new Error();
    return values;
  } catch {
    throw new HubError('Artifact recovery intent is invalid.');
  }
}

export async function recordArtifactWrites(
  root: string,
  changes: ArtifactChange[],
  inFlight = true,
): Promise<void> {
  if (!changes.length) return;
  // A path has one first-touch owner, even when hooks and MCP edit the same file.
  const files = await readBaseline(root);
  const textChanges: FileIntent[] = [];
  for (const change of changes) {
    if (!files?.files.some((entry) => entry.file === change.before.path)) continue;
    const after = change.source ? await inspectArtifact(change.source) : null;
    if (!['file', 'missing'].includes(change.before.kind) || (after && after.kind !== 'file'))
      throw new HubError('A text recovery target cannot be replaced with a non-text artifact.');
    textChanges.push({
      before: {
        file: change.before.path,
        realFile: change.before.physicalPath,
        content: change.rollbackSource ? await readOptionalText(change.rollbackSource) : null,
        mode: change.before.mode,
      },
      after: change.source ? await readOptionalText(change.source) : null,
      afterMode: after?.mode,
    });
  }
  if (textChanges.length) await recordFileIntents(root, textChanges);
  const expected = await readIntents(root);
  for (const change of changes)
    Object.defineProperty(expected, change.before.path, {
      value: [
        ...new Set([
          change.before.fingerprint,
          change.afterFingerprint,
          ...(inFlight ? [missingArtifactFingerprint] : []),
        ]),
      ],
      enumerable: true,
      configurable: true,
    });
  await fs.mkdir(directory(root), { recursive: true, mode: 0o700 });
  await writeAtomic(intentsFile(root), JSON.stringify(expected, null, 2) + '\n', 0o600);
}

export async function planArtifactReset(root: string, archiveChanges: boolean) {
  const baseline = await readArtifactBaseline(root);
  const expected = await readIntents(root);
  return Promise.all(
    baseline.entries.map(async (entry) => {
      const current = await inspectArtifact(entry.before.path);
      const changed = current.fingerprint !== entry.before.fingerprint;
      const outsideChanges = changed && !expected[entry.before.path]?.includes(current.fingerprint);
      const bindingChanged =
        current.physicalPath !== entry.before.physicalPath ||
        (current.kind === 'symlink' && outsideChanges);
      return {
        ...entry,
        current,
        changed,
        outsideChanges,
        bindingChanged,
        conflict: bindingChanged || (outsideChanges && !archiveChanges),
        original: entry.payload ? path.join(directory(root), entry.payload) : null,
      };
    }),
  );
}

/** Keep artifact-owned config intents current when the text engine writes them. */
export async function recordArtifactFileWrites(root: string, changes: FileChange[]): Promise<void> {
  const baseline = await readArtifactBaseline(root);
  const selected = changes.filter((change) =>
    baseline.entries.some((entry) => entry.before.path === path.resolve(change.before.file)),
  );
  if (!selected.length) return;
  const expected = await readIntents(root);
  for (const change of selected) {
    const before = await inspectArtifact(change.before.file);
    const after =
      change.after === null
        ? missingArtifactFingerprint
        : hash(
            stableStringify({
              kind: 'file',
              mode: change.before.mode,
              content: hash(change.after),
            }),
          );
    Object.defineProperty(expected, before.path, {
      value: [before.fingerprint, after],
      enumerable: true,
      configurable: true,
    });
  }
  await writeAtomic(intentsFile(root), JSON.stringify(expected, null, 2) + '\n', 0o600);
}
