import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import type { SessionScan } from '../core/types.js';
import { hash, isRecord } from '../core/values.js';
import { isAbsoluteLocalPath } from '../core/paths.js';

const defaults = { entries: 2048, files: 256, bytes: 4 * 1024 * 1024, prefix: 64 * 1024 };

/** Selected local store only. No settings, transcript bodies or inferred folder names leave here. */
export async function claudeSessions(home: string, limits = defaults): Promise<SessionScan> {
  const result: SessionScan = {
    source: hash(path.resolve(home)),
    coverage: 'complete',
    sessions: [],
    filesRead: 0,
    bytesRead: 0,
    issues: [],
  };
  const issue = (message: string) => {
    result.coverage = 'partial';
    if (!result.issues.includes(message)) result.issues.push(message);
  };
  let root: string;
  try {
    root = await fs.realpath(home);
    result.source = hash(root);
    const directory = path.join(root, 'projects');
    if ((await fs.realpath(directory)) !== directory) throw new Error();
    if (!(await fs.lstat(directory)).isDirectory()) throw new Error();
  } catch (error) {
    result.coverage =
      (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'not-found' : 'unavailable';
    result.issues.push('Local session directory could not be read.');
    return result;
  }
  let entriesRead = 0;
  const entries = async (directory: string) => {
    const items = [];
    try {
      // Do not allocate an unbounded directory listing before checking the budget.
      for await (const item of await fs.opendir(directory)) {
        if (++entriesRead > limits.entries) {
          issue('Directory entry limit reached; results are incomplete.');
          break;
        }
        items.push(item);
      }
    } catch {
      issue('A session collection could not be read.');
    }
    return items.sort((a, b) => a.name.localeCompare(b.name));
  };
  for (const collection of await entries(path.join(root, 'projects'))) {
    if (entriesRead > limits.entries) break;
    if (collection.isSymbolicLink()) {
      issue('Symbolic links in session collections were skipped.');
      continue;
    }
    if (!collection.isDirectory() || collection.name.startsWith('.')) continue;
    const directory = path.join(root, 'projects', collection.name);
    for (const item of await entries(directory)) {
      if (!item.name.endsWith('.jsonl')) continue;
      if (result.filesRead >= limits.files || result.bytesRead >= limits.bytes) {
        issue('Session read limit reached; results may be incomplete.');
        break;
      }
      if (!item.isFile() || item.isSymbolicLink()) {
        issue('A non-regular session file was skipped.');
        continue;
      }
      const file = path.join(directory, item.name);
      try {
        if ((await fs.realpath(file)) !== file) throw new Error();
        const handle = await fs.open(
          file,
          constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
        );
        try {
          const before = await handle.stat();
          if (!before.isFile()) throw new Error();
          const buffer = Buffer.alloc(Math.min(limits.prefix, limits.bytes - result.bytesRead));
          const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
          result.bytesRead += bytesRead;
          result.filesRead++;
          const after = await handle.stat();
          if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) {
            issue('A session changed during reading; retry discovery.');
            continue;
          }
          const text = buffer.subarray(0, bytesRead).toString('utf8');
          // Never parse the final unterminated record, even when the file fits in the buffer.
          const lines = text
            .slice(0, text.lastIndexOf('\n') + 1)
            .split('\n')
            .filter(Boolean);
          const ids = new Set<string>();
          const locations = new Set<string>();
          let sidechain = false;
          for (const line of lines) {
            let value: unknown;
            try {
              value = JSON.parse(line);
            } catch {
              issue('Malformed session metadata was skipped.');
              continue;
            }
            if (!isRecord(value)) continue;
            if (value.isSidechain === true) sidechain = true;
            if (
              typeof value.sessionId === 'string' &&
              /^[a-zA-Z0-9_-]{1,128}$/.test(value.sessionId)
            )
              ids.add(value.sessionId);
            if (isAbsoluteLocalPath(value.cwd)) locations.add(path.normalize(value.cwd));
          }
          if (sidechain) continue;
          if (ids.size !== 1 || !locations.size) {
            issue('Some sessions have no supported project metadata in the bounded prefix.');
            continue;
          }
          result.sessions.push({ id: [...ids][0]!, locations: [...locations].sort() });
        } finally {
          await handle.close();
        }
      } catch {
        issue('A session file could not be safely read.');
      }
    }
    if (result.filesRead >= limits.files || result.bytesRead >= limits.bytes) {
      issue('Session read limit reached; results may be incomplete.');
      break;
    }
  }
  return result;
}
