import path from 'node:path';
import { HubError } from '../../shared/errors.js';
import { readOptionalText } from '../../shared/file-store.js';
import { hubRoot } from '../../shared/paths.js';
import { readRegistry } from '../configuration/registry.js';
import { readSettings } from '../configuration/settings.js';
import { cachedDoctor } from '../diagnostics/doctor.js';
import { planContextSync } from '../instructions/sync.js';
import { readAutomation } from '../memory/automation/config.js';
import { planAutomationSetup } from '../memory/automation/setup.js';
import { autoStatus } from '../memory/automation/status.js';
import { memoryOverview } from '../projects/catalog.js';
import { collectStatus, type StatusReport } from './status.js';

export async function readiness(
  options: {
    root?: string;
    workspace?: string;
    status?: StatusReport;
    doctor?: Awaited<ReturnType<typeof cachedDoctor>>;
    inspectContext?: boolean;
  } = {},
) {
  const root = options.root ?? hubRoot();
  const initialized = (await readOptionalText(path.join(root, 'hub.yaml'))) !== null;
  const status = options.status ?? (await collectStatus());
  const settings = await readSettings(root, true);
  const clients = status.clients.filter(
    (client) => client.installed && settings.clients?.[client.id]?.enabled !== false,
  );
  const differences = status.drift.filter((item) =>
    clients.some((client) => client.id === item.client),
  );
  const issues: string[] = [];
  let contextPending = false;
  if (initialized && options.inspectContext !== false) {
    try {
      const plan = await planContextSync();
      contextPending = plan.blocked || plan.requests.length > 0;
    } catch (error) {
      contextPending = true;
      issues.push(
        error instanceof HubError ? error.message : 'Shared instruction delivery needs review.',
      );
    }
  }
  const configured = initialized && clients.length > 0 && !differences.length && !contextPending;
  const configuration = !initialized ? 'setup-required' : configured ? 'matched' : 'needs-review';
  const registry = await readRegistry(path.join(root, 'mcp/servers.yaml'));
  const serverNames = Object.keys(registry.servers);
  const doctor = options.doctor === undefined ? await cachedDoctor() : options.doctor;
  const results = doctor?.report.results ?? [];
  const connections = !serverNames.length
    ? 'not-configured'
    : !doctor
      ? 'not-checked'
      : doctor.stale
        ? 'stale'
        : serverNames.some(
              (name) => !results.some((result) => result.name === name && result.status === 'ok'),
            )
          ? 'needs-review'
          : 'passed';
  const serviceWarnings = results.filter(
    (result) => result.service?.status === 'unavailable',
  ).length;
  const memory = await memoryOverview(root, options.workspace ?? process.cwd());
  let activity: Awaited<ReturnType<typeof autoStatus>>['activity'] = [];
  if (memory.projectId && memory.automation) {
    try {
      activity = (await autoStatus(root, memory.projectDirectory!)).activity;
    } catch (error) {
      issues.push(
        error instanceof HubError ? error.message : 'Memory activity could not be inspected.',
      );
    }
  }
  let hooks = !memory.projectId ? 'not-connected' : !memory.automation ? 'disabled' : 'installed';
  if (memory.projectId && memory.automation && options.inspectContext !== false) {
    try {
      const { policy } = await readAutomation(root, memory.projectDirectory!);
      for (const client of policy.clients) {
        const setup = await planAutomationSetup(root, memory.projectDirectory!, client);
        if (setup.blocked) hooks = 'needs-review';
        else if (setup.requests.length && hooks !== 'needs-review') hooks = 'needs-setup';
      }
    } catch (error) {
      hooks = 'needs-review';
      issues.push(error instanceof HubError ? error.message : 'Hook setup needs review.');
    }
  } else if (memory.automation) hooks = 'not-checked';
  const memoryState = !memory.projectId
    ? 'not-connected'
    : !memory.automation
      ? 'disabled'
      : activity.some((item) => item.checkpointAt)
        ? 'checkpoint-observed'
        : activity.some((item) => item.hookAt)
          ? 'hook-observed'
          : 'configured-not-observed';
  const label = !initialized
    ? 'Set up the shared Hub'
    : !configured
      ? 'Shared configuration needs review'
      : connections === 'passed' && serviceWarnings
        ? 'Shared configuration matched · backend service needs review'
        : connections === 'passed' && !serviceWarnings
          ? 'Shared configuration matched · MCP checks passed'
          : connections === 'not-configured'
            ? 'Shared configuration matched · no MCP servers configured'
            : 'Shared configuration matched · runtime verification pending';
  return {
    label,
    configuration,
    connections,
    serviceWarnings,
    clients: clients.length,
    differences: differences.length,
    contextPending,
    issues: [...issues, ...memory.issues],
    memory: { ...memory, state: memoryState, hooks, activity },
    next:
      !initialized || !configured
        ? 'ahub quick'
        : (connections !== 'passed' || serviceWarnings > 0) && serverNames.length
          ? 'ahub doctor'
          : memoryState === 'configured-not-observed'
            ? 'Restart the selected client, review hook permissions and open the connected project.'
            : null,
  };
}
