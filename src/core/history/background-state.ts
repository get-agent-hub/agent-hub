import fs from 'node:fs/promises';
import { z } from 'zod';
import { HubError } from '../../shared/errors.js';
import { snapshot, writeChecked } from '../../shared/file-store.js';
import { historySourceSchema, ownedHistoryPath } from './storage.js';

const token = z.string().regex(/^[a-f0-9]{32}$/);
const policy = z.object({
  version: z.literal(1),
  id: token,
  enabled: z.boolean(),
  interval: z.number().int().min(5).max(300),
  binding: z.string(),
  sources: z.array(historySourceSchema).min(1).max(100),
});
const state = z.object({
  id: token,
  pid: z.number().int().positive(),
  phase: z.enum(['starting', 'capturing', 'waiting', 'retrying', 'stopped']),
  heartbeat: z.string(),
  lastAttempt: z.string().optional(),
  lastSuccess: z.string().optional(),
  error: z.string().optional(),
});
const lease = state.pick({ id: true, pid: true });
export type BackgroundPolicy = z.infer<typeof policy>;
export type BackgroundState = z.infer<typeof state>;

export async function backgroundFile(root: string, name: string) {
  return ownedHistoryPath(root, `background-${name}.json`);
}
export async function readBackgroundPolicy(root: string) {
  return read(root, 'policy', policy);
}
export async function readBackgroundState(root: string) {
  return read(root, 'state', state);
}
export async function readBackgroundLease(root: string) {
  return read(root, 'lease', lease);
}
async function read<T>(root: string, name: string, schema: z.ZodType<T>): Promise<T | null> {
  const before = await snapshot(await backgroundFile(root, name));
  if (before.content === null) return null;
  try {
    return schema.parse(JSON.parse(before.content));
  } catch {
    throw new HubError('Background update metadata is invalid. Preserve it before recovery.');
  }
}
export async function writeBackground(root: string, name: string, value: unknown) {
  const before = await snapshot(await backgroundFile(root, name));
  await writeChecked({ ...before, mode: 0o600 }, JSON.stringify(value) + '\n');
}
export async function backgroundBinding(root: string) {
  const stat = await fs.stat(root, { bigint: true });
  return `${stat.dev}:${stat.ino}`;
}
export function alive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}
export async function backgroundStopped(root: string, id: string) {
  const before = await snapshot(await backgroundFile(root, 'stop'));
  if (before.content === null) return false;
  try {
    return z.object({ id: token }).strict().parse(JSON.parse(before.content)).id === id;
  } catch {
    throw new HubError('Background stop metadata is invalid. Preserve it before recovery.');
  }
}

/** A process lease, distinct from the short Hub mutation lock. Never signal a saved PID. */
export async function claimBackground(root: string, id: string) {
  const file = await backgroundFile(root, 'lease');
  const before = await snapshot(file);
  if (before.content !== null) {
    let owner;
    try {
      owner = lease.parse(JSON.parse(before.content));
    } catch {
      throw new HubError('Background update ownership is invalid. Inspect it before recovery.');
    }
    if (alive(owner.pid)) throw new HubError('A background updater is already running.');
    await writeChecked(before, null);
  }
  const handle = await fs.open(file, 'wx', 0o600);
  const content = JSON.stringify({ id, pid: process.pid });
  try {
    await handle.writeFile(content);
    await handle.sync();
  } catch (error) {
    await handle.close();
    throw error;
  }
  const owned = await handle.stat();
  return async () => {
    await handle.close();
    try {
      const current = await fs.lstat(file);
      if (current.dev === owned.dev && current.ino === owned.ino) {
        const latest = await snapshot(file);
        if (latest.content === content) await writeChecked(latest, null);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  };
}
