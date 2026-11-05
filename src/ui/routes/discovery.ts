import type { ClientId } from '../../contracts/clients.js';
import { CLIENT_IDS } from '../../contracts/clients.js';
import { createDiscoveryJobs } from '../project-discovery.js';
import { RequestError, jsonBody, type UiRoute } from '../protocol.js';
import type { UiSession } from '../session.js';

export function createDiscoveryRoutes(session: UiSession) {
  const { services, token } = session;
  let discovering = false;
  const discoveryJobs = createDiscoveryJobs(
    (clients, control) => services.discoverProjects(clients, undefined, control),
    services.revealDirectory,
  );
  const handle: UiRoute = async ({ req, res, url, json }) => {
    if (
      req.method === 'POST' &&
      ['/api/projects/discover', '/api/projects/discovery/start'].includes(url.pathname)
    ) {
      if (req.headers['x-agent-hub-token'] !== token)
        throw new RequestError(403, 'Refresh the page before finding projects.');
      const body = await jsonBody(req);
      if (
        Object.keys(body).some((key) => key !== 'clients') ||
        !Array.isArray(body.clients) ||
        !body.clients.length ||
        body.clients.length > CLIENT_IDS.length ||
        new Set(body.clients).size !== body.clients.length ||
        body.clients.some((id) => !CLIENT_IDS.includes(id as ClientId))
      )
        throw new RequestError(
          400,
          'Choose known clients once each. Source paths cannot be supplied.',
        );
      if (url.pathname.endsWith('/start')) {
        const id = discoveryJobs.start(body.clients as ClientId[]);
        json(202, discoveryJobs.status(id));
        return true;
      }
      if (discovering) throw new RequestError(409, 'Project discovery is already running.');
      const id = discoveryJobs.start(body.clients as ClientId[]);
      discovering = true;
      const stopped = () => {
        if (!res.writableEnded) discoveryJobs.stop(id);
      };
      res.once('close', stopped);
      try {
        const job = await discoveryJobs.wait(id);
        if (res.destroyed) return true;
        if (job.state !== 'complete')
          throw new RequestError(
            job.state === 'failed' ? 500 : 409,
            job.error ?? 'Discovery stopped.',
          );
        json(200, discoveryJobs.status(id));
      } finally {
        res.removeListener('close', stopped);
        discovering = false;
      }
      return true;
    }
    if (
      req.method === 'POST' &&
      [
        '/api/projects/discovery/status',
        '/api/projects/discovery/cancel',
        '/api/projects/discovery/reveal',
      ].includes(url.pathname)
    ) {
      if (req.headers['x-agent-hub-token'] !== token)
        throw new RequestError(403, 'Refresh the page before accessing project discovery.');
      const body = await jsonBody(req);
      const status = url.pathname.endsWith('/status');
      const reveal = url.pathname.endsWith('/reveal');
      const allowed = status
        ? ['id', 'offset', 'query']
        : reveal
          ? ['id', 'projectId', 'location']
          : ['id'];
      if (
        Object.keys(body).some((key) => !allowed.includes(key)) ||
        (body.id !== undefined &&
          (typeof body.id !== 'string' || !/^[a-f0-9]{32}$/.test(body.id))) ||
        (!status && body.id === undefined)
      )
        throw new RequestError(400, 'Choose a retained scan ID. Paths are not accepted.');
      if (status) {
        if (
          (body.offset !== undefined &&
            (!Number.isInteger(body.offset) ||
              Number(body.offset) < 0 ||
              Number(body.offset) > 2000)) ||
          (body.query !== undefined && (typeof body.query !== 'string' || body.query.length > 256))
        )
          throw new RequestError(400, 'Invalid result page.');
        if (!body.id && !discoveryJobs.currentId()) json(200, { job: null });
        else
          json(
            200,
            discoveryJobs.status(
              body.id as string | undefined,
              Number(body.offset ?? 0),
              String(body.query ?? ''),
            ),
          );
      } else if (reveal) {
        if (
          typeof body.projectId !== 'string' ||
          !/^discovered:[a-f0-9]{24}$/.test(body.projectId) ||
          (body.location !== undefined &&
            (!Number.isInteger(body.location) ||
              Number(body.location) < 0 ||
              Number(body.location) > 127))
        )
          throw new RequestError(400, 'Choose a discovered folder.');
        await discoveryJobs.reveal(body.id as string, body.projectId, Number(body.location ?? 0));
        json(200, { revealed: true });
      } else {
        discoveryJobs.stop(body.id as string);
        json(200, discoveryJobs.status(body.id as string));
      }
      return true;
    }
    return false;
  };
  return { handle, close: () => discoveryJobs.close() };
}
