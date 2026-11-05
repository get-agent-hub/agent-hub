import { RequestError, jsonBody, type UiRoute } from '../protocol.js';
import type { UiSession } from '../session.js';

export function createMemoryRoutes(session: UiSession) {
  const { services, token } = session;

  const handle: UiRoute = async ({ req, url, json }) => {
    if (req.method === 'GET' && url.pathname === '/api/memory') {
      const scope = url.searchParams.get('scope') ?? 'project';
      const id = url.searchParams.get('id');
      json(
        200,
        id === null
          ? await services.memory.list(
              scope,
              url.searchParams.get('query') ?? '',
              Number(url.searchParams.get('limit') ?? 50),
            )
          : await services.memory.get(id, scope),
      );
      return true;
    }
    if (req.method === 'GET' && url.pathname === '/api/memory/automation') {
      json(200, await services.memory.automation());
      return true;
    }
    if (req.method === 'GET' && url.pathname === '/api/memory/conflict') {
      json(200, await services.memory.conflict(url.searchParams.get('id') ?? ''));
      return true;
    }
    if (req.method === 'GET' && url.pathname === '/api/memory/discovery') {
      json(200, await services.memory.discover());
      return true;
    }
    if (
      req.method === 'POST' &&
      [
        '/api/memory/preview',
        '/api/memory/conflict/preview',
        '/api/memory/onboarding/preview',
        '/api/memory/apply',
      ].includes(url.pathname)
    ) {
      if (req.headers['x-agent-hub-token'] !== token)
        throw new RequestError(403, 'Refresh the page before making changes.');
      if (session.applying) throw new RequestError(409, 'Another operation is running.');
      const body = await jsonBody(req, 160 * 1024);
      if (session.applying) throw new RequestError(409, 'Another operation is running.');
      if (url.pathname === '/api/memory/onboarding/preview') {
        if (
          Object.keys(body).some((key) => !['sources', 'follow'].includes(key)) ||
          !Array.isArray(body.sources) ||
          !body.sources.length ||
          body.sources.length > 20 ||
          !body.sources.every((id) => typeof id === 'string') ||
          typeof body.follow !== 'boolean'
        )
          throw new RequestError(400, 'Choose source IDs and whether to follow later changes.');
        json(200, await services.memory.previewOnboarding(body.sources as string[], body.follow));
      } else if (url.pathname === '/api/memory/conflict/preview') {
        if (
          Object.keys(body).some((key) => !['id', 'take'].includes(key)) ||
          typeof body.id !== 'string' ||
          typeof body.take !== 'string'
        )
          throw new RequestError(400, 'A conflict ID and resolution choice are required.');
        json(200, await services.memory.previewConflict(body.id, body.take));
      } else if (url.pathname.endsWith('/preview')) json(200, await services.memory.preview(body));
      else {
        if (
          Object.keys(body).some((key) => !['id', 'revision'].includes(key)) ||
          typeof body.id !== 'string' ||
          typeof body.revision !== 'string'
        )
          throw new RequestError(400, 'A preview ID and revision are required.');
        session.applying = true;
        try {
          json(200, await services.memory.apply(body.id, body.revision));
        } finally {
          session.applying = false;
        }
      }
      return true;
    }
    return false;
  };
  return handle;
}
