import { HubError } from './errors.js';
import { snapshot, writeChecked, type FileSnapshot } from './file-store.js';

export interface FileChange {
  before: FileSnapshot;
  after: string | null;
}
type Writer = typeof writeChecked;

/** Guarded replacements with compensating rollback, not a crash-safe database transaction. */
export async function writeTransaction(
  changes: FileChange[],
  write: Writer = writeChecked,
): Promise<void> {
  const paths = new Set<string>();
  for (const { before } of changes) {
    if (paths.has(before.realFile))
      throw new HubError('A transaction cannot write the same file twice.');
    paths.add(before.realFile);
    const current = await snapshot(before.file);
    if (current.content !== before.content || current.realFile !== before.realFile) {
      throw new HubError('Configuration changed since planning. Review a new plan.');
    }
  }
  const written: FileChange[] = [];
  try {
    for (const change of changes) {
      await write(change.before, change.after);
      written.push(change);
    }
  } catch (error) {
    const failed: string[] = [];
    for (const { before, after } of written.reverse()) {
      try {
        await write({ ...before, content: after }, before.content);
      } catch {
        failed.push(before.file);
      }
    }
    if (failed.length)
      throw new HubError(
        `Update failed; rollback requires manual review for: ${failed.join(', ')}.`,
      );
    throw new HubError(
      `Update failed and written files were rolled back. ${error instanceof HubError ? error.message : 'Check file permissions.'}`,
    );
  }
}
