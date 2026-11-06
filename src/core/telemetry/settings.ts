import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { snapshot, writeChecked } from '../../shared/file-store.js';
import { HubError } from '../../shared/errors.js';

const settings = z.discriminatedUnion('enabled', [
  z.object({ version: z.literal(1), enabled: z.literal(false) }).strict(),
  z.object({ version: z.literal(1), enabled: z.literal(true), id: z.string().uuid() }).strict(),
]);
type Settings = z.infer<typeof settings>;
export const telemetryFile = () =>
  process.env.AGENT_HUB_TELEMETRY_STATE ||
  path.join(
    process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'),
    'agent-hub',
    'telemetry.json',
  );
export function telemetryEndpoint() {
  const url = new URL(
    process.env.AGENT_HUB_TELEMETRY_URL || 'https://metrics.getahub.dev/v1/events',
  );
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/v1/events'
  )
    throw new Error('Invalid metrics endpoint.');
  return url.href;
}
export const telemetryBlocked = () =>
  Boolean(
    process.env.NODE_TEST_CONTEXT ||
    process.env.CI ||
    process.env.DO_NOT_TRACK === '1' ||
    process.env.AGENT_HUB_TELEMETRY_DISABLED === '1',
  );

export async function readTelemetry(): Promise<Settings | null> {
  try {
    const file = telemetryFile();
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.size > 1024) return { version: 1, enabled: false };
    return settings.parse(JSON.parse(await fs.readFile(file, 'utf8')));
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT'
      ? null
      : { version: 1, enabled: false };
  }
}
export async function telemetryStatus() {
  const saved = await readTelemetry();
  let destination: string | null = null;
  try {
    destination = new URL(telemetryEndpoint()).origin;
  } catch {
    /* Fail closed. */
  }
  const blocked = telemetryBlocked() || !destination;
  return { enabled: !blocked && saved?.enabled !== false, blocked, destination };
}

// Telemetry preferences live outside Hub recovery. A busy or abandoned lock drops metrics;
// DO_NOT_TRACK remains available even when private configuration cannot be written.
async function changeSettings<T>(action: () => Promise<T>): Promise<T> {
  const file = telemetryFile();
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const lock = await fs.open(file + '.lock', 'wx', 0o600);
  try {
    return await action();
  } finally {
    await lock.close();
    await fs.unlink(file + '.lock');
  }
}
async function save(value: Settings) {
  const file = telemetryFile();
  try {
    if ((await fs.lstat(file)).isSymbolicLink()) throw new Error('Symlink.');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  await writeChecked({ ...(await snapshot(file)), mode: 0o600 }, JSON.stringify(value) + '\n');
}
export async function setTelemetry(enabled: boolean) {
  try {
    if (enabled && telemetryBlocked()) throw new Error('Disabled by environment.');
    await changeSettings(async () => {
      const current = await readTelemetry();
      await save(
        enabled
          ? { version: 1, enabled: true, id: current?.enabled ? current.id : randomUUID() }
          : { version: 1, enabled: false },
      );
    });
    return await telemetryStatus();
  } catch {
    throw new HubError(
      'Could not save analytics preferences. Check permissions or a telemetry.json.lock left by an interrupted update. DO_NOT_TRACK=1 disables collection without writing settings.',
    );
  }
}
export async function telemetryIdentity(): Promise<string | null> {
  if (!(await telemetryStatus()).enabled) return null;
  const current = await readTelemetry();
  if (current) return current.enabled ? current.id : null;
  try {
    return await changeSettings(async () => {
      const latest = await readTelemetry();
      if (latest) return latest.enabled ? latest.id : null;
      const id = randomUUID();
      await save({ version: 1, enabled: true, id });
      return id;
    });
  } catch {
    return null;
  }
}
