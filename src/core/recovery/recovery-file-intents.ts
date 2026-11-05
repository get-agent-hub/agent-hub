import path from 'node:path';
import { HubError } from '../../shared/errors.js';
import { readOptionalText, writeAtomic } from '../../shared/file-store.js';
import type { FileChange } from '../../shared/file-transaction.js';
import { hash } from '../../shared/values.js';
import { recoveryStorage } from './recovery-storage.js';

export interface FileIntent extends FileChange {
  afterMode?: number;
}

export interface ExpectedWrites {
  version: 1;
  files: Record<string, { hashes: string[]; modes: number[] }>;
}
export async function readExpectedWrites(root: string): Promise<ExpectedWrites> {
  const text = await readOptionalText(path.join(recoveryStorage(root), 'expected.json'));
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

/** Shared text journal writer; artifact writes use it without recursively bridging again. */
export async function recordFileIntents(root: string, changes: FileIntent[]): Promise<void> {
  const expected = await readExpectedWrites(root);
  for (const change of changes)
    Object.defineProperty(expected.files, path.resolve(change.before.file), {
      value: {
        hashes: [...new Set([hash(change.before.content), hash(change.after)])],
        modes: [...new Set([change.before.mode, change.afterMode ?? change.before.mode])],
      },
      enumerable: true,
      configurable: true,
      writable: true,
    });
  await writeAtomic(
    path.join(recoveryStorage(root), 'expected.json'),
    JSON.stringify(expected, null, 2) + '\n',
    0o600,
  );
}
