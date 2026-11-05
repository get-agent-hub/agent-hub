import { randomBytes } from 'node:crypto';
import type { ClientId } from '../../contracts/clients.js';
import { planQuick } from '../../core/setup/quick.js';
import { RequestError, jsonBody, type UiRoute } from '../protocol.js';
import type { UiSession } from '../session.js';

export function createSetupRoutes(session: UiSession) {
  const { services, token } = session;
  const quickPreviews = new Map<
    string,
    { plan: Awaited<ReturnType<typeof planQuick>>; expires: number }
  >();

  session.trackPreviews(quickPreviews);
  const handle: UiRoute = async ({ req, url, json }) => {
    if (
      req.method === 'POST' &&
      [
        '/api/quick/preview',
        '/api/quick/apply',
        '/api/project/connect/preview',
        '/api/project/connect/apply',
      ].includes(url.pathname)
    ) {
      const project = url.pathname.startsWith('/api/project/');
      if (project && session.selectedProject === null)
        throw new RequestError(
          409,
          'Select a registered project or the startup folder before connecting.',
        );
      if (req.headers['x-agent-hub-token'] !== token)
        throw new RequestError(403, 'Refresh the page before running setup.');
      if (session.applying) throw new RequestError(409, 'Another operation is running.');
      const body = await jsonBody(req);
      if (session.applying) throw new RequestError(409, 'Another operation is running.');
      if (url.pathname.endsWith('/preview')) {
        const allowed = project ? ['clients', 'automation'] : ['clients', 'prefer'];
        if (Object.keys(body).some((key) => !allowed.includes(key)))
          throw new RequestError(
            400,
            project
              ? 'Project connection is bound to the UI startup project.'
              : 'Quick configures the shared Hub only. Use Connect project for memory and handoff.',
          );
        if (
          body.clients !== undefined &&
          (!Array.isArray(body.clients) || body.clients.some((id) => typeof id !== 'string'))
        )
          throw new RequestError(400, 'Choose known clients.');
        if (
          (body.prefer !== undefined && typeof body.prefer !== 'string') ||
          (body.automation !== undefined && typeof body.automation !== 'boolean')
        )
          throw new RequestError(400, 'Invalid setup options.');
        const plan = project
          ? await services.projectPlan({
              workspace: session.selectedWorkspace,
              clients: body.clients as ClientId[] | undefined,
              automation: body.automation as boolean | undefined,
            })
          : await services.quickPlan({
              clients: body.clients as ClientId[] | undefined,
              prefer: body.prefer as ClientId | undefined,
            });
        for (const [id, saved] of quickPreviews)
          if (saved.expires < Date.now()) quickPreviews.delete(id);
        while (quickPreviews.size >= 10) quickPreviews.delete(quickPreviews.keys().next().value!);
        const id = randomBytes(16).toString('hex');
        quickPreviews.set(id, { plan, expires: Date.now() + 5 * 60_000 });
        json(200, { ...plan.publicPlan, previewId: id });
        return true;
      }
      const id = typeof body.previewId === 'string' ? body.previewId : '';
      const saved = quickPreviews.get(id);
      quickPreviews.delete(id);
      if (
        !saved ||
        saved.plan.publicPlan.scope !== (project ? 'project' : 'hub') ||
        saved.expires < Date.now() ||
        body.revision !== saved.plan.publicPlan.revision
      )
        throw new RequestError(
          409,
          'Quick preview expired or was already used. Run a new preview.',
        );
      session.applying = true;
      try {
        json(
          200,
          await (project ? services.projectApply : services.quickApply)(
            saved.plan,
            saved.plan.publicPlan.revision,
          ),
        );
      } finally {
        session.applying = false;
      }
      return true;
    }
    return false;
  };
  return handle;
}
