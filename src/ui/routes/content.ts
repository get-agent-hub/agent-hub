import { randomBytes } from 'node:crypto';
import type { ClientId } from '../../contracts/clients.js';
import { applyManagedPlan, publicManagedPlan } from '../../core/recovery/managed-plan.js';
import { type ContentOperation, type ContentOptions } from '../../core/setup/content.js';
import { RequestError, jsonBody, type UiRoute } from '../protocol.js';
import type { UiSession } from '../session.js';

export function createContentRoutes(session: UiSession) {
  const { services, token } = session;
  const contentPreviews = new Map<
    string,
    { operation: ContentOperation; options: ContentOptions; revision: string; expires: number }
  >();

  session.trackPreviews(contentPreviews);
  const handle: UiRoute = async ({ req, url, json }) => {
    if (
      req.method === 'POST' &&
      ['/api/content/preview', '/api/content/apply'].includes(url.pathname)
    ) {
      if (req.headers['x-agent-hub-token'] !== token)
        throw new RequestError(403, 'Refresh the page before making changes.');
      if (session.applying) throw new RequestError(409, 'Another operation is running.');
      const body = await jsonBody(req);
      if (session.applying) throw new RequestError(409, 'Another operation is running.');
      if (url.pathname.endsWith('/preview')) {
        const operation = body.operation as ContentOperation;
        if (
          session.selectedProject === null &&
          ['init-repo', 'project-disconnect'].includes(operation)
        )
          throw new RequestError(409, 'Select a project before changing repository setup.');
        const contentOptions: ContentOptions = {
          client: body.client as ClientId | undefined,
          source: body.source as ClientId | undefined,
          name: body.name as string | undefined,
          only: body.only as string[] | undefined,
          prefer: body.prefer as string | undefined,
          overwrite: body.overwrite as boolean | undefined,
          replace: body.replace as string[] | undefined,
        };
        if (contentOptions.prefer !== undefined && typeof contentOptions.prefer !== 'string')
          throw new RequestError(400, 'Choose a known source preference.');
        const plan = await services.contentPlan(
          operation,
          contentOptions,
          session.selectedWorkspace,
        );
        for (const [id, preview] of contentPreviews)
          if (preview.expires < Date.now()) contentPreviews.delete(id);
        if (contentPreviews.size >= 50)
          contentPreviews.delete(contentPreviews.keys().next().value!);
        const id = randomBytes(16).toString('hex');
        contentPreviews.set(id, {
          operation,
          options: contentOptions,
          revision: plan.revision,
          expires: Date.now() + 5 * 60_000,
        });
        json(200, { id, ...publicManagedPlan(plan) });
        return true;
      }
      const id = typeof body.id === 'string' ? body.id : '';
      const preview = contentPreviews.get(id);
      if (!preview || preview.expires < Date.now())
        throw new RequestError(409, 'Preview expired. Review a new plan.');
      session.applying = true;
      try {
        const rebuild = () => services.contentPlan(preview.operation, preview.options);
        const plan = await rebuild();
        if (plan.revision !== preview.revision || plan.blocked)
          throw new RequestError(409, 'Inputs changed or the plan is blocked. Review a new plan.');
        contentPreviews.delete(id);
        json(200, await applyManagedPlan(plan, rebuild, preview.revision));
      } finally {
        session.applying = false;
      }
      return true;
    }
    return false;
  };
  return handle;
}
