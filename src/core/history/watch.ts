import { setTimeout } from 'node:timers/promises';
import type { HistoryControl, HistorySource } from '../../contracts/history.js';
import { HubError } from '../../shared/errors.js';
import { ingestHistory } from './ingest.js';

/** Periodic checked reconciliation handles lost file-watch events and atomic source replacements. */
export async function watchHistory(
  root: string,
  options: HistoryControl & { interval?: number; sources?: HistorySource[] } = {},
) {
  const interval = options.interval ?? 30;
  if (!Number.isFinite(interval) || interval < 5 || interval > 300)
    throw new HubError('Choose a history refresh interval of 5–300 seconds.');
  while (!options.signal?.aborted) {
    await ingestHistory(root, options.sources, options);
    await setTimeout(interval * 1000, undefined, { signal: options.signal });
  }
}
