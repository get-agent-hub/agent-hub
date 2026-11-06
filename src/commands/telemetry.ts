import { setTelemetry, telemetryStatus } from '../core/telemetry/settings.js';
import { HubError } from '../shared/errors.js';
import { printJson } from '../shared/output.js';

export async function telemetryCommand(state = 'status') {
  if (!['on', 'off', 'status'].includes(state))
    throw new HubError('Choose telemetry on, off or status.');
  const result = state === 'status' ? await telemetryStatus() : await setTelemetry(state === 'on');
  printJson(result);
}
