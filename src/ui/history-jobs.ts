import { randomBytes } from 'node:crypto';
import type { HistoryReceipt, HistorySource } from '../contracts/history.js';
import { ingestHistory } from '../core/history/ingest.js';
import { HubError } from '../shared/errors.js';

interface HistoryJob {
  id: string;
  state: 'running' | 'complete' | 'cancelled' | 'failed';
  receipts: HistoryReceipt[];
  error?: string;
}
export function createHistoryJobs(root: string, changed: (running: boolean) => void) {
  let current: HistoryJob | undefined;
  let controller: AbortController | undefined;
  let pending: Promise<void> | undefined;
  function start(sources: HistorySource[]) {
    if (current?.state === 'running') throw new HubError('An archive update is already running.');
    const job: HistoryJob = { id: randomBytes(16).toString('hex'), state: 'running', receipts: [] };
    current = job;
    controller = new AbortController();
    changed(true);
    const signal = controller.signal;
    pending = ingestHistory(root, sources, {
      signal,
      onProgress(receipt) {
        job.receipts = [
          ...job.receipts.filter((item) => item.source.id !== receipt.source.id),
          receipt,
        ];
      },
    })
      .then(() => {
        job.state = 'complete';
      })
      .catch(() => {
        job.state = signal.aborted ? 'cancelled' : 'failed';
        job.error = signal.aborted
          ? 'Update stopped. Completed conversations are retained.'
          : 'Archive update failed. Previously saved conversations are retained. Check storage and source access.';
      })
      .finally(() => changed(false));
    return job;
  }
  return {
    start,
    status: () => current ?? null,
    cancel: () => {
      controller?.abort();
      return current;
    },
    close: async () => {
      controller?.abort();
      await pending;
    },
  };
}
