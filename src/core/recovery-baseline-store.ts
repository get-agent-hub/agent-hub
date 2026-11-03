import path from 'node:path';
import { readOptionalText, type FileSnapshot } from './file-store.js';
import type { TreeSnapshot } from './recovery-tree.js';
import { recoveryRoot } from './recovery-paths.js';
import { containsPath } from './artifacts.js';
import { HubError } from './errors.js';

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
              !containsPath(directory, file.realFile) ||
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
