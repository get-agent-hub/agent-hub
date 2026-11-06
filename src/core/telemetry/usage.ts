import { spawn } from 'node:child_process';
import path from 'node:path';
import { z } from 'zod';
import { cliPath } from '../../shared/runtime.js';
import { packageVersion } from '../../shared/package.js';
import {
  readTelemetry,
  telemetryBlocked,
  telemetryEndpoint,
  telemetryIdentity,
} from './settings.js';

export const usageEvent = z.enum([
  'app_opened',
  'setup_completed',
  'archive_updated',
  'search_performed',
  'chat_opened',
  'context_exported',
  'shared_config_delivered',
]);
export type UsageEvent = z.infer<typeof usageEvent>;
export const usageRequest = z.object({ event: usageEvent, id: z.string().uuid() }).strict();
const recent = new Map<string, number>();

/** One bounded detached attempt. No network work or queue in a CLI command/UI request. */
export function recordUsage(event: UsageEvent) {
  if (!usageEvent.safeParse(event).success || telemetryBlocked()) return;
  void (async () => {
    const id = await telemetryIdentity();
    if (!id) return;
    const now = Date.now();
    if (now - (recent.get(event) ?? 0) < 2000) return;
    recent.set(event, now);
    const env: NodeJS.ProcessEnv = {};
    for (const key of [
      'HOME',
      'USERPROFILE',
      'XDG_CONFIG_HOME',
      'AGENT_HUB_TELEMETRY_STATE',
      'AGENT_HUB_TELEMETRY_URL',
      'AGENT_HUB_TELEMETRY_DISABLED',
      'DO_NOT_TRACK',
      'CI',
      'NODE_TEST_CONTEXT',
      'NODE_EXTRA_CA_CERTS',
    ])
      if (process.env[key] !== undefined) env[key] = process.env[key];
    const child = spawn(
      process.execPath,
      [path.join(path.dirname(cliPath), 'workers/telemetry.js')],
      {
        detached: true,
        windowsHide: true,
        stdio: ['pipe', 'ignore', 'ignore'],
        env,
      },
    );
    child.on('error', () => undefined);
    child.stdin.on('error', () => undefined);
    child.stdin.end(JSON.stringify({ event, id }));
    child.unref();
  })().catch(() => undefined);
}

/** Recheck opt-out and identity in the worker immediately before attempting delivery. */
export async function sendUsage(input: unknown, transport: typeof fetch = fetch) {
  const parsed = usageRequest.safeParse(input);
  if (!parsed.success || telemetryBlocked()) return;
  const current = await readTelemetry();
  if (!current?.enabled || current.id !== parsed.data.id) return;
  try {
    const response = await transport(telemetryEndpoint(), {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(1000),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        enabled: true,
        surface: 'product',
        event: parsed.data.event,
        distinct_id: current.id,
        language: 'en',
        version: packageVersion,
      }),
    });
    await response.body?.cancel();
  } catch {
    /* Analytics cannot fail the user's task; no retries or backlog. */
  }
}
