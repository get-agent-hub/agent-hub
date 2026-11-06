import fs from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import type { HistorySource } from '../../contracts/history.js';
import { HubError } from '../../shared/errors.js';
import { withHubLock } from '../../shared/hub-lock.js';
import { ensureBaseline } from '../recovery/baseline.js';
import { historySource } from '../../adapters/history/sources.js';
import {
  alive,
  backgroundBinding,
  backgroundStopped,
  readBackgroundPolicy,
  readBackgroundLease,
  readBackgroundState,
  writeBackground,
} from './background-state.js';
import { readHistory } from './storage.js';

export async function backgroundStatus(root: string) {
  const policy = await readBackgroundPolicy(root);
  const saved = await readBackgroundState(root);
  const lease = await readBackgroundLease(root);
  const current = saved?.id === policy?.id ? saved : null;
  const running = !!lease && alive(lease.pid);
  const stopping = !!policy && (await backgroundStopped(root, policy.id));
  return {
    enabled: policy?.enabled ?? false,
    running,
    state: !running
      ? 'stopped'
      : stopping || current?.phase === 'stopped'
        ? 'stopping'
        : (current?.phase ?? 'starting'),
    responsive: running && !!current && Date.now() - Date.parse(current.heartbeat) < 15000,
    interval: policy?.interval ?? 30,
    sources: policy?.sources.map((source) => source.id) ?? [],
    lastAttempt: current?.lastAttempt ?? null,
    lastSuccess: current?.lastSuccess ?? null,
    error: current?.error ?? null,
  };
}

export async function configureBackground(root: string, sources: HistorySource[], interval = 30) {
  if (!Number.isInteger(interval) || interval < 5 || interval > 300)
    throw new HubError('Choose a history refresh interval of 5–300 seconds.');
  if (!sources.length || sources.length > 100)
    throw new HubError('Choose at least one native history source, up to 100.');
  return withHubLock(root, async (origin) => {
    const status = await backgroundStatus(root);
    if (status.running)
      throw new HubError('Turn off background updates before changing their sources.');
    await ensureBaseline(root, [], origin);
    const catalog = await readHistory(root);
    const selected: HistorySource[] = [];
    for (const source of sources) {
      if (historySource(source.client, source.root).id !== source.id)
        throw new HubError('Invalid history source identity.');
      const registered = catalog.sources.find((item) => item.id === source.id);
      let binding = registered?.binding;
      try {
        const stat = await fs.stat(source.root);
        const observed = `${stat.dev}:${stat.ino}`;
        if (binding && binding !== observed)
          throw new HubError('A selected source was replaced. Review its archive binding first.');
        binding = observed;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      if (!selected.some((item) => item.id === source.id)) selected.push({ ...source, binding });
    }
    const policy = {
      version: 1 as const,
      id: randomBytes(16).toString('hex'),
      enabled: true,
      interval,
      binding: await backgroundBinding(root),
      sources: selected,
    };
    await writeBackground(root, 'policy', policy);
    return policy;
  });
}

export async function requestBackgroundStop(root: string) {
  const policy = await readBackgroundPolicy(root);
  if (policy) await writeBackground(root, 'stop', { id: policy.id });
  return backgroundStatus(root);
}

export async function finishBackgroundStop(root: string) {
  return withHubLock(root, async () => {
    const policy = await readBackgroundPolicy(root);
    if (policy && (await backgroundStopped(root, policy.id)))
      await writeBackground(root, 'policy', { ...policy, enabled: false });
  });
}
