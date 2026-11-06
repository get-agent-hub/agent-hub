import { fork } from 'node:child_process';
import { setTimeout } from 'node:timers/promises';
import type { HistorySource } from '../../contracts/history.js';
import { HubError } from '../../shared/errors.js';
import {
  backgroundStatus,
  configureBackground,
  finishBackgroundStop,
  requestBackgroundStop,
} from './background.js';

export async function startHistoryBackground(
  root: string,
  sources: HistorySource[],
  interval = 30,
) {
  const previous = await backgroundStatus(root);
  if (
    previous.running &&
    previous.state !== 'stopping' &&
    previous.interval === interval &&
    previous.sources.length === sources.length &&
    sources.every((source) => previous.sources.includes(source.id))
  )
    return previous;
  if (previous.running)
    throw new HubError('Turn off background updates before changing their sources.');
  const policy = await configureBackground(root, sources, interval);
  const worker = fork(new URL('../../workers/history.js', import.meta.url), [root, policy.id], {
    detached: true,
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    execArgv: [],
    cwd: root,
  });
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = globalThis.setTimeout(
        () => reject(new HubError('Background startup was not confirmed. Check history status.')),
        10000,
      );
      const done = (error?: Error) => {
        clearTimeout(timer);
        worker.removeAllListeners('message');
        worker.removeAllListeners('error');
        worker.removeAllListeners('exit');
        if (error) reject(error);
        else resolve();
      };
      worker.once('error', () => done(new HubError('Could not start background updates.')));
      worker.once('exit', () => done(new HubError('Background updater did not start. Retry.')));
      worker.once('message', (message) => {
        if ((message as { ready?: unknown })?.ready === true) done();
        else done(new HubError('Background updater did not start. Retry.'));
      });
    });
  } finally {
    if (worker.connected) worker.disconnect();
    worker.unref();
  }
  return backgroundStatus(root);
}

export async function stopHistoryBackground(root: string) {
  const initial = await requestBackgroundStop(root);
  if (!initial.enabled && !initial.running) return initial;
  for (let attempt = 0; attempt < 100; attempt++) {
    const status = await backgroundStatus(root);
    if (!status.running) {
      await finishBackgroundStop(root);
      return backgroundStatus(root);
    }
    await setTimeout(100);
  }
  // Cooperative I/O can take longer than this HTTP/CLI wait. The request remains in force.
  return backgroundStatus(root);
}
