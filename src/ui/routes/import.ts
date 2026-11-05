import { randomBytes } from 'node:crypto';
import type { ClientId } from '../../contracts/clients.js';
import { publicImportPlan } from '../../core/mcp/import-plan.js';
import { RequestError, jsonBody, type UiRoute } from '../protocol.js';
import type { UiSession } from '../session.js';

export function createImportRoutes(session: UiSession) {
  const { services, token } = session;
  const previews = new Map<
    string,
    {
      item: string;
      source?: ClientId;
      prefer: string;
      overwrite: boolean;
      revision: string;
      expires: number;
    }
  >();

  session.trackPreviews(previews);
  const handle: UiRoute = async ({ req, url, json }) => {
    if (
      req.method === 'POST' &&
      ['/api/import/preview', '/api/import/apply'].includes(url.pathname)
    ) {
      if (req.headers['x-agent-hub-token'] !== token)
        throw new RequestError(403, 'Refresh the page before making changes.');
      if (session.applying) throw new RequestError(409, 'An import is already running.');
      const body = await jsonBody(req);
      if (session.applying) throw new RequestError(409, 'An import is already running.');
      if (url.pathname.endsWith('/preview')) {
        const item = typeof body.item === 'string' ? body.item : 'mcp';
        if (item !== 'mcp' && !/^mcp:.{1,200}$/.test(item))
          throw new RequestError(400, 'Choose MCP servers to import.');
        const prefer = typeof body.prefer === 'string' ? body.prefer : '';
        if (prefer && !/^(claude-code|codex|dsh)(,(claude-code|codex|dsh))*$/.test(prefer))
          throw new RequestError(400, 'Unknown source client.');
        const overwrite = body.overwrite === true;
        const source = body.source as ClientId | undefined;
        if (source !== undefined && !['dsh', 'codex', 'claude-code'].includes(source))
          throw new RequestError(400, 'Choose a known source client.');
        const plan = await services.plan(item, { source, prefer, overwrite });
        const id = randomBytes(16).toString('hex');
        for (const [key, p] of previews) if (p.expires < Date.now()) previews.delete(key);
        if (previews.size >= 50) previews.delete(previews.keys().next().value!);
        previews.set(id, {
          item,
          source,
          prefer,
          overwrite,
          revision: plan.revision,
          expires: Date.now() + 5 * 60_000,
        });
        json(200, { id, ...publicImportPlan(plan) });
        return true;
      }
      const id = typeof body.id === 'string' ? body.id : '';
      const preview = previews.get(id);
      if (!preview || preview.expires < Date.now())
        throw new RequestError(409, 'Preview expired. Review the import again.');
      session.applying = true;
      try {
        const plan = await services.plan(preview.item, preview);
        if (plan.revision !== preview.revision)
          throw new RequestError(
            409,
            'Configuration changed since preview. Review the import again.',
          );
        if (plan.blocked) throw new RequestError(409, 'Resolve import conflicts before applying.');
        previews.delete(id);
        json(200, await services.apply(plan));
      } finally {
        session.applying = false;
      }
      return true;
    }
    return false;
  };
  return handle;
}
