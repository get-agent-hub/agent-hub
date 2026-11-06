import { setTelemetry, telemetryStatus } from '../../core/telemetry/settings.js';
import { recordUsage, usageEvent } from '../../core/telemetry/usage.js';
import { RequestError, jsonBody, type UiRoute } from '../protocol.js';
import type { UiSession } from '../session.js';

export function createTelemetryRoutes(session: UiSession): UiRoute {
  return async ({ req, url, json }) => {
    if (!url.pathname.startsWith('/api/telemetry')) return false;
    if (req.method !== 'POST' || req.headers['x-agent-hub-token'] !== session.token)
      throw new RequestError(403, 'Refresh the page before changing analytics.');
    const body = await jsonBody(req);
    if (url.pathname === '/api/telemetry/settings') {
      if (Object.keys(body).length !== 1 || typeof body.enabled !== 'boolean')
        throw new RequestError(400, 'Choose whether to enable analytics.');
      json(200, await setTelemetry(body.enabled));
    } else if (url.pathname === '/api/telemetry/event') {
      const event = usageEvent.safeParse(body.event);
      if (!event.success || Object.keys(body).length !== 1)
        throw new RequestError(400, 'Unknown usage event.');
      if (req.headers.dnt !== '1' && req.headers['sec-gpc'] !== '1') recordUsage(event.data);
      json(202, { accepted: true });
    } else if (url.pathname === '/api/telemetry/status' && !Object.keys(body).length)
      json(200, await telemetryStatus());
    else throw new RequestError(404, 'Analytics action not found.');
    return true;
  };
}
