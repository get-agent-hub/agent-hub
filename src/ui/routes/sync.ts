import { randomBytes } from 'node:crypto';
import { publicSyncPlan, type SyncOptions } from '../../core/mcp/sync.js';
import { RequestError, jsonBody, type UiRoute } from '../protocol.js';
import type { UiSession } from '../session.js';

export function createSyncRoutes(session: UiSession) {
  const { services, token } = session;
  const syncPreviews = new Map<
    string,
    { options: SyncOptions; revision: string; expires: number }
  >();

  session.trackPreviews(syncPreviews);
  const handle: UiRoute = async ({ req, url, json }) => {
    if (req.method === 'POST' && ['/api/sync/preview', '/api/sync/apply'].includes(url.pathname)) {
      if (req.headers['x-agent-hub-token'] !== token)
        throw new RequestError(403, 'Refresh the page before making changes.');
      if (session.applying) throw new RequestError(409, 'Another operation is running.');
      const body = await jsonBody(req);
      if (session.applying) throw new RequestError(409, 'Another operation is running.');
      if (url.pathname.endsWith('/preview')) {
        if (
          body.client !== undefined &&
          !['dsh', 'codex', 'claude-code'].includes(String(body.client))
        )
          throw new RequestError(400, 'Choose a known client.');
        const client = body.client as 'dsh' | 'codex' | 'claude-code' | undefined;
        const syncOptions: SyncOptions = {
          client,
          only: body.only as string[] | undefined,
          replace: body.replace as string[] | undefined,
        };
        const plan = await services.syncPlan(syncOptions);
        const id = randomBytes(16).toString('hex');
        for (const [key, p] of syncPreviews) if (p.expires < Date.now()) syncPreviews.delete(key);
        if (syncPreviews.size >= 50) syncPreviews.delete(syncPreviews.keys().next().value!);
        syncPreviews.set(id, {
          options: syncOptions,
          revision: plan.revision,
          expires: Date.now() + 5 * 60_000,
        });
        json(200, { id, ...publicSyncPlan(plan) });
        return true;
      }
      const id = typeof body.id === 'string' ? body.id : '';
      const preview = syncPreviews.get(id);
      if (!preview || preview.expires < Date.now())
        throw new RequestError(409, 'Preview expired. Run a new dry run.');
      session.applying = true;
      try {
        const plan = await services.syncPlan(preview.options);
        if (plan.revision !== preview.revision)
          throw new RequestError(
            409,
            'Configuration changed since the dry run. Review a new plan.',
          );
        if (plan.blocked)
          throw new RequestError(409, 'Resolve the conflicts in this plan before applying.');
        syncPreviews.delete(id);
        json(200, await services.syncApply(plan));
      } finally {
        session.applying = false;
      }
      return true;
    }
    return false;
  };
  return handle;
}
