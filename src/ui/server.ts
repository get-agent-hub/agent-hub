import { createTelemetryRoutes } from './routes/telemetry.js';
import http from 'node:http';
import { HubError } from '../shared/errors.js';
import { serveAsset } from './assets.js';
import { RequestError } from './protocol.js';
import { createContentRoutes } from './routes/content.js';
import { createDiscoveryRoutes } from './routes/discovery.js';
import { createDoctorRoutes } from './routes/doctor.js';
import { createImportRoutes } from './routes/import.js';
import { createHistoryRoutes } from './routes/history.js';
import { createMemoryRoutes } from './routes/memory.js';
import { createSetupRoutes } from './routes/setup.js';
import { createStateRoutes } from './routes/state.js';
import { createSyncRoutes } from './routes/sync.js';
import { createUiSession, type UiOptions } from './session.js';

export async function startUiServer(options: UiOptions = {}) {
  const session = createUiSession(options);
  let origin = '';
  const discovery = createDiscoveryRoutes(session);
  const doctor = createDoctorRoutes(session);
  const history = createHistoryRoutes(session);
  const routes = [
    createStateRoutes(session),
    createTelemetryRoutes(session),
    discovery.handle,
    history.handle,
    createSetupRoutes(session),
    createMemoryRoutes(session),
    doctor.handle,
    createSyncRoutes(session),
    createImportRoutes(session),
    createContentRoutes(session),
  ];
  const server = http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    );
    const json = (code: number, data: unknown) => {
      res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(data));
    };

    try {
      if (
        req.headers.host !== new URL(origin).host ||
        (req.headers.origin && req.headers.origin !== origin) ||
        req.headers['sec-fetch-site'] === 'cross-site'
      ) {
        throw new RequestError(403, 'Open Agent Hub using its local URL.');
      }
      const url = new URL(req.url ?? '/', origin);
      if (req.method === 'GET' && (await serveAsset(url.pathname, res))) return;
      for (const handle of routes) if (await handle({ req, res, url, json })) return;
      json(404, { error: 'Not found.' });
    } catch (e) {
      // Parser and subprocess errors can contain raw config/credentials.
      if (!res.headersSent)
        json(e instanceof RequestError ? e.status : e instanceof HubError ? 409 : 500, {
          error:
            e instanceof RequestError || e instanceof HubError
              ? e.message
              : 'Unable to read or update the hub. Check file permissions and configuration, then refresh.',
        });
      else res.end();
    }
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 3082, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve();
    });
  });
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('Could not bind local UI.');
  origin = `http://127.0.0.1:${addr.port}`;

  return {
    server,
    url: origin,
    close: async () => {
      discovery.close();
      await history.close();
      await doctor.close();
      await new Promise<void>((resolve, reject) => {
        server.close((e) => (e ? reject(e) : resolve()));
        server.closeIdleConnections();
      });
    },
  };
}
