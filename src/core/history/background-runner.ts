import { setTimeout } from 'node:timers/promises';
import { ingestHistory } from './ingest.js';
import {
  backgroundBinding,
  backgroundStopped,
  claimBackground,
  readBackgroundPolicy,
  writeBackground,
  type BackgroundState,
} from './background-state.js';

/** One owner, sequential captures, and an independent cooperative stop/heartbeat loop. */
export async function runHistoryBackground(
  root: string,
  id: string,
  options: { signal?: AbortSignal; ready?: () => void } = {},
) {
  const policy = await readBackgroundPolicy(root);
  if (!policy?.enabled || policy.id !== id || (await backgroundStopped(root, id))) return;
  if (policy.binding !== (await backgroundBinding(root))) return;
  const release = await claimBackground(root, id);
  const controller = new AbortController();
  const signal = controller.signal;
  const abort = () => controller.abort();
  options.signal?.addEventListener('abort', abort, { once: true });
  if (options.signal?.aborted) abort();
  const state: BackgroundState = {
    id,
    pid: process.pid,
    phase: 'starting',
    heartbeat: new Date().toISOString(),
  };
  const valid = async () => {
    const current = await readBackgroundPolicy(root);
    return (
      current?.id === id &&
      current.enabled &&
      current.binding === (await backgroundBinding(root)) &&
      !(await backgroundStopped(root, id))
    );
  };
  let published = '';
  const pulse = async () => {
    while (!signal.aborted) {
      if (!(await valid())) return abort();
      const signature = JSON.stringify({ ...state, heartbeat: undefined });
      if (signature !== published || Date.now() - Date.parse(state.heartbeat) >= 5000) {
        state.heartbeat = new Date().toISOString();
        await writeBackground(root, 'state', state);
        published = signature;
      }
      await setTimeout(1000, undefined, { signal });
    }
  };
  let monitor: Promise<void> | undefined;
  try {
    if (!(await valid()) || signal.aborted) return;
    await writeBackground(root, 'state', state);
    options.ready?.();
    monitor = pulse().catch(abort);
    while (!signal.aborted && (await valid())) {
      state.phase = 'capturing';
      state.lastAttempt = new Date().toISOString();
      try {
        const catalog = await ingestHistory(root, policy.sources, { signal });
        const receipts = catalog.receipts.filter(
          (receipt) =>
            policy.sources.some((source) => source.id === receipt.source.id) &&
            !catalog.excluded.includes(receipt.source.id),
        );
        const incomplete = receipts.some((receipt) => receipt.coverage !== 'complete');
        state.phase = incomplete ? 'retrying' : 'waiting';
        state.error = incomplete
          ? 'Some sources could not be read completely. Saved chats are retained; another attempt is scheduled.'
          : undefined;
        if (!incomplete && receipts.length) state.lastSuccess = new Date().toISOString();
      } catch {
        if (signal.aborted) break;
        state.phase = 'retrying';
        state.error =
          'Update could not finish. Saved chats are retained; another attempt is scheduled. Check source access, storage and Hub locks.';
      }
      await setTimeout(policy.interval * 1000, undefined, { signal });
    }
  } catch {
    // Stop requests, reset/replacement and invalid control metadata fail closed.
  } finally {
    abort();
    await monitor;
    options.signal?.removeEventListener('abort', abort);
    try {
      if (
        (await readBackgroundPolicy(root))?.id === id &&
        policy.binding === (await backgroundBinding(root))
      ) {
        state.phase = 'stopped';
        state.heartbeat = new Date().toISOString();
        await writeBackground(root, 'state', state);
      }
    } catch {
      // Never recreate a reset or replaced Hub to publish a final status.
    }
    await release();
  }
}
