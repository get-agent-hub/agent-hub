import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { setImmediate } from 'node:timers/promises';
import type { SessionScan, SessionDiscoveryControl } from '../core/types.js';
import { hash, isRecord } from '../core/values.js';
import { isAbsoluteLocalPath } from '../core/paths.js';

// Per-job safety ceilings, separate from small batches used for progress and continuation.
const defaults = {
  entries: 200_000,
  files: 100_000,
  bytes: 256 * 1024 * 1024,
  prefix: 1024 * 1024,
};
const chunkBytes = 4096;

async function metadata(
  file: string,
  allowance: number,
  signal: AbortSignal | undefined,
  onRead: (bytes: number) => void,
) {
  if ((await fs.realpath(file)) !== file) throw new Error();
  const handle = await fs.open(
    file,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  let bytes = 0;
  const ids = new Set<string>();
  const locations = new Set<string>();
  let sidechain = false;
  let malformed = false;
  try {
    const before = await handle.stat();
    if (!before.isFile()) throw new Error();
    const decoder = new StringDecoder('utf8');
    let pending = '';
    while (bytes < allowance) {
      signal?.throwIfAborted();
      const buffer = Buffer.alloc(Math.min(chunkBytes, allowance - bytes));
      const read = await handle.read(buffer, 0, buffer.length, bytes);
      signal?.throwIfAborted();
      if (!read.bytesRead) break;
      bytes += read.bytesRead;
      onRead(read.bytesRead);
      pending += decoder.write(buffer.subarray(0, read.bytesRead));
      let end: number;
      while ((end = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, end);
        pending = pending.slice(end + 1);
        if (!line.trim()) continue;
        let value: unknown;
        try {
          value = JSON.parse(line);
        } catch {
          malformed = true;
          continue;
        }
        if (!isRecord(value)) continue;
        if (value.isSidechain === true) sidechain = true;
        if (typeof value.sessionId === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value.sessionId))
          ids.add(value.sessionId);
        if (isAbsoluteLocalPath(value.cwd)) locations.add(path.normalize(value.cwd));
        if (locations.size > 64 || ids.size > 1) break;
      }
      // Initial context only. Do not read a whole transcript to collect later cwd changes.
      if (
        sidechain ||
        ids.size > 1 ||
        locations.size > 64 ||
        (bytes >= Math.min(64 * 1024, allowance) && ids.size === 1 && locations.size)
      )
        break;
      await setImmediate(undefined, { signal });
    }
    const after = await handle.stat();
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) throw new Error();
    return {
      bytes,
      malformed,
      sidechain,
      session:
        ids.size === 1 && locations.size && locations.size <= 64
          ? { id: [...ids][0]!, locations: [...locations].sort() }
          : null,
    };
  } finally {
    await handle.close();
  }
}

/** Read initial local context in bounded batches, never returning message bodies. */
export async function claudeSessions(
  home: string,
  limits = defaults,
  control: SessionDiscoveryControl = {},
): Promise<SessionScan> {
  control.signal?.throwIfAborted();
  const result: SessionScan = {
    source: hash(path.resolve(home)),
    coverage: 'complete',
    sessions: [],
    filesRead: 0,
    bytesRead: 0,
    entriesRead: 0,
    unresolvedFiles: 0,
    skippedFiles: 0,
    finished: false,
    issues: [],
  };
  const issue = (message: string) => {
    result.coverage = 'partial';
    if (!result.issues.includes(message)) result.issues.push(message);
  };
  let root: string;
  try {
    root = await fs.realpath(home);
    const projects = path.join(root, 'projects');
    if ((await fs.realpath(projects)) !== projects || !(await fs.lstat(projects)).isDirectory())
      throw new Error();
    result.source = hash(root);
    result.directory = projects;
  } catch (error) {
    result.coverage =
      (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'not-found' : 'unavailable';
    result.issues.push(
      'Local session directory could not be read. Check the configured Claude data directory.',
    );
    result.finished = true;
    return result;
  }
  let batch: SessionScan['sessions'] = [];
  let lastEntries = 0;
  let lastFiles = 0;
  let callbackFailed = false;
  const publish = async (force = false) => {
    control.signal?.throwIfAborted();
    if (!force && result.entriesRead! - lastEntries < 128 && result.filesRead - lastFiles < 32)
      return;
    if (control.onBatch) {
      try {
        await control.onBatch({ ...result, sessions: batch });
      } catch (error) {
        callbackFailed = true;
        throw error;
      }
      batch = [];
    }
    lastEntries = result.entriesRead!;
    lastFiles = result.filesRead;
    await setImmediate(undefined, { signal: control.signal });
  };
  let limited = false;
  const entry = () => {
    control.signal?.throwIfAborted();
    if (result.entriesRead! >= limits.entries) {
      limited = true;
      return false;
    }
    result.entriesRead!++;
    return true;
  };
  try {
    const projects = path.join(root, 'projects');
    const rootBefore = await fs.stat(projects);
    const collections: { directory: string; mtime: number; files: string[]; next: number }[] = [];
    let knownFiles = 0;
    result.phase = 'enumerating';
    inventory: for await (const collection of await fs.opendir(projects)) {
      if (!entry()) break;
      await publish();
      if (collection.isSymbolicLink()) {
        issue('Symbolic links in session collections were skipped.');
        continue;
      }
      if (!collection.isDirectory() || collection.name.startsWith('.')) continue;
      const directory = path.join(projects, collection.name);
      try {
        if ((await fs.realpath(directory)) !== directory) throw new Error();
        const before = await fs.stat(directory);
        const stored = { directory, mtime: before.mtimeMs, files: [] as string[], next: 0 };
        collections.push(stored);
        for await (const item of await fs.opendir(directory)) {
          if (!entry()) break inventory;
          await publish();
          if (!item.name.endsWith('.jsonl')) continue;
          if (!item.isFile() || item.isSymbolicLink()) {
            issue('A non-regular session file was skipped.');
            result.skippedFiles!++;
            continue;
          }
          if (knownFiles >= limits.files) {
            limited = true;
            break inventory;
          }
          stored.files.push(path.join(directory, item.name));
          knownFiles++;
        }
      } catch (error) {
        control.signal?.throwIfAborted();
        if (callbackFailed) throw error;
        issue('A session collection could not be read. Retry after restoring access.');
      }
    }
    result.totalFiles = knownFiles;
    result.phase = 'reading';
    await publish(true);
    // Round-robin collections: a large early project cannot starve later projects.
    let remaining = knownFiles;
    reading: while (remaining) {
      for (const collection of collections) {
        const file = collection.files[collection.next];
        if (!file) continue;
        if (
          result.bytesRead >= limits.bytes ||
          (!control.onBatch && result.sessions.length >= 5000)
        ) {
          limited = true;
          break reading;
        }
        collection.next++;
        remaining--;
        let found;
        try {
          found = await metadata(
            file,
            Math.min(limits.prefix, limits.bytes - result.bytesRead),
            control.signal,
            (bytes) => {
              result.bytesRead += bytes;
            },
          );
        } catch {
          control.signal?.throwIfAborted();
          result.filesRead++;
          result.unresolvedFiles!++;
          issue('A session changed or could not be safely read. Retry discovery.');
          await publish();
          continue;
        }
        result.filesRead++;
        if (found.sidechain) result.skippedFiles!++;
        else {
          if (found.malformed) issue('Malformed session records were skipped.');
          if (found.session) {
            if (control.onBatch) batch.push(found.session);
            else result.sessions.push(found.session);
          } else {
            result.unresolvedFiles!++;
            issue(
              'Some files have no supported initial context within the metadata limit. These chats are not counted.',
            );
          }
        }
        await publish();
      }
    }
    for (const collection of collections) {
      control.signal?.throwIfAborted();
      if (collection.mtime !== (await fs.stat(collection.directory)).mtimeMs)
        issue('A session collection changed during discovery. Run another scan.');
    }
    if (rootBefore.mtimeMs !== (await fs.stat(projects)).mtimeMs)
      issue('Session collections changed during discovery. Run another scan.');
  } catch (error) {
    control.signal?.throwIfAborted();
    if (callbackFailed) throw error;
    issue('Session enumeration could not finish. Retry after restoring access.');
    limited = true;
  }
  if (limited)
    issue('The supported per-scan capacity was reached. The remaining metadata is not checked.');
  result.finished = !limited;
  await publish(true);
  return result;
}
