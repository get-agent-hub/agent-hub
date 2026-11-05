import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { readAutomation } from '../core/memory/automation/config.js';
import {
  getAutomaticConflict,
  planAutomaticResolution,
} from '../core/memory/automation/conflicts.js';
import { automaticCheckpoint, memoryHook } from '../core/memory/automation/runtime.js';
import { planAutomationDisable, planAutomationSetup } from '../core/memory/automation/setup.js';
import { autoStatus } from '../core/memory/automation/status.js';
import { planNativeSync, syncNativeAutomatically } from '../core/memory/automation/sync.js';
import { HubError } from '../shared/errors.js';
import { printJson } from '../shared/output.js';
import { hubRoot } from '../shared/paths.js';
import { runManaged, type ManagedOptions } from './content.js';

interface AutoOptions extends ManagedOptions {
  workspace?: string;
  client?: string;
  nativeDir?: string;
  at?: string;
  resolve?: string[];
  interval?: string;
  token?: string;
  take?: string;
  version?: string;
}
const workspaceOf = (options: AutoOptions) => path.resolve(options.workspace ?? process.cwd());

async function stdinJson() {
  let body = '';
  for await (const chunk of process.stdin) {
    body += chunk;
    if (Buffer.byteLength(body) > 256 * 1024)
      throw new HubError('Automation input exceeds its 256 KiB limit.');
  }
  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new HubError('Automation expects one JSON object on stdin.');
  }
}

export async function autoEnableCommand(options: AutoOptions) {
  await runManaged(
    () =>
      planAutomationSetup(hubRoot(), workspaceOf(options), options.client, {
        nativeDir: options.nativeDir,
      }),
    options,
  );
  if (options.apply) {
    const result = await syncNativeAutomatically(hubRoot(), workspaceOf(options));
    if (!options.json)
      console.log(
        `Automatic native import: ${result.changedPaths} path(s), ${result.conflicts} conflict(s), ${result.skipped} skipped item(s).`,
      );
  }
}
export const autoDisableCommand = (options: AutoOptions) =>
  runManaged(() => planAutomationDisable(hubRoot(), workspaceOf(options)), options);
export const autoSyncCommand = (options: AutoOptions) => {
  const at = options.at ?? new Date().toISOString();
  return runManaged(
    () => planNativeSync(hubRoot(), workspaceOf(options), at, options.resolve),
    options,
  );
};
export async function autoHookCommand(options: AutoOptions) {
  try {
    printJson(await memoryHook(hubRoot(), options.client, await stdinJson()));
  } catch (error) {
    console.error(error instanceof HubError ? error.message : 'Agent Hub memory hook failed.');
    printJson({
      systemMessage:
        'Agent Hub memory automation did not finish. Inspect memory auto status; the agent task can continue.',
    });
  }
}
export async function autoCheckpointCommand(options: AutoOptions) {
  if (!options.token) throw new HubError('Checkpoint needs its active hook token.');
  printJson(
    await automaticCheckpoint(
      hubRoot(),
      workspaceOf(options),
      options.client,
      options.token,
      await stdinJson(),
    ),
  );
}

export async function autoStatusCommand(options: AutoOptions) {
  const status = await autoStatus(hubRoot(), workspaceOf(options));
  if (options.json) printJson(status);
  else {
    console.log(
      `Automation: ${status.policy.enabled ? 'enabled' : 'disabled'} (${status.scope})\nClients: ${status.policy.clients.join(', ') || 'none'}\nNative sources: ${status.policy.native.length}\nConflicts: ${status.conflicts.length}\nPending checkpoints: ${status.pendingCheckpoints}`,
    );
    for (const conflict of status.conflicts)
      console.log(`${conflict.id}: ${conflict.reason} Source: ${conflict.source}`);
    for (const source of status.native) {
      if (source.error) console.log(`${source.directory}: ${source.error}`);
      for (const item of source.skipped) console.log(`${item.path}: ${item.reason}`);
    }
  }
}

export async function autoConflictGetCommand(id: string, options: AutoOptions) {
  const { snapshot: _snapshot, ...conflict } = await getAutomaticConflict(
    hubRoot(),
    workspaceOf(options),
    id,
    options.version,
  );
  printJson(conflict);
}
export const autoConflictResolveCommand = (id: string, options: AutoOptions) => {
  const at = options.at ?? new Date().toISOString();
  return runManaged(
    () => planAutomaticResolution(hubRoot(), workspaceOf(options), id, options.take ?? '', at),
    options,
  );
};

export async function autoWatchCommand(options: AutoOptions) {
  const seconds = Number(options.interval ?? 30);
  if (!Number.isFinite(seconds) || seconds < 5 || seconds > 300)
    throw new HubError('Watch interval must be 5–300 seconds.');
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  try {
    while (!controller.signal.aborted) {
      const { policy } = await readAutomation(hubRoot(), workspaceOf(options));
      if (!policy.enabled) break;
      try {
        const result = await syncNativeAutomatically(hubRoot(), workspaceOf(options));
        if (result.changedPaths || result.conflicts || result.skipped) printJson(result);
      } catch (error) {
        console.error(
          error instanceof HubError
            ? error.message
            : 'Automatic native memory sync failed; retrying on the next interval.',
        );
      }
      await delay(seconds * 1000, undefined, { signal: controller.signal }).catch(
        (error: unknown) => {
          if (!controller.signal.aborted) throw error;
        },
      );
    }
  } finally {
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
  }
}
