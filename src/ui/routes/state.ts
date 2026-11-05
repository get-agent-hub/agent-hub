import { projectCatalog, registeredWorkspace } from '../../core/projects/catalog.js';
import { sessionDiscoveryClients } from '../../core/projects/discovery.js';
import { hubRoot } from '../../shared/paths.js';
import { RequestError, jsonBody, type UiRoute } from '../protocol.js';
import type { UiSession } from '../session.js';

export function createStateRoutes(session: UiSession) {
  const { services, token } = session;

  const handle: UiRoute = async ({ req, url, json }) => {
    if (req.method === 'GET' && url.pathname === '/api/state') {
      let state: {
        [key: string]: unknown;
        readiness?: {
          next?: string | null;
          memory?: { projectId?: string | null; defaultScope?: string };
        };
      };
      let projects: Awaited<ReturnType<typeof projectCatalog>>;
      try {
        state = (await services.state(session.selectedWorkspace)) as typeof state;
        projects = await projectCatalog(hubRoot());
      } catch {
        // Discovery must not depend on parsing an unrelated client's settings.
        state = {
          stateUnavailable: true,
          stateIssue:
            'Some settings could not be read. Project discovery is still available. Check client and Hub configuration before applying other changes.',
          status: {
            hub: { root: hubRoot(), exists: false },
            clients: [],
            skills: [],
            mcp: [],
            drift: [],
          },
          servers: [],
          memory: [],
          workspace: null,
          instructions: { content: null },
          updatedAt: new Date().toISOString(),
        };
        projects = [];
      }
      json(200, {
        ...state,
        ...(session.selectedProject === null
          ? {
              workspace: null,
              readiness: state.readiness
                ? {
                    ...state.readiness,
                    next: state.readiness.next?.startsWith('ahub ') ? state.readiness.next : null,
                    memory: {
                      ...state.readiness.memory,
                      projectId: null,
                      projectDirectory: null,
                      projectRecords: 0,
                      defaultScope: 'shared',
                      state: 'not-connected',
                      hooks: 'not-connected',
                      automation: false,
                      activity: [],
                    },
                  }
                : undefined,
            }
          : {}),
        projects,
        discoveryClients: sessionDiscoveryClients(),
        selection: {
          mode:
            session.selectedProject === undefined
              ? 'current'
              : session.selectedProject === null
                ? 'shared'
                : 'project',
          projectId:
            session.selectedProject === undefined
              ? (state.readiness?.memory?.projectId ?? null)
              : session.selectedProject,
          memoryScope:
            session.selectedProject === null
              ? 'shared'
              : (state.readiness?.memory?.defaultScope ?? 'shared'),
        },
        token,
      });
      return true;
    }
    if (req.method === 'POST' && url.pathname === '/api/project/select') {
      if (req.headers['x-agent-hub-token'] !== token)
        throw new RequestError(403, 'Refresh the page before selecting a project.');
      if (session.applying) throw new RequestError(409, 'Another operation is running.');
      const body = await jsonBody(req);
      if (
        Object.keys(body).some((key) => key !== 'projectId') ||
        !(body.projectId === null || typeof body.projectId === 'string')
      )
        throw new RequestError(
          400,
          'Choose a registered project ID, current folder or shared knowledge.',
        );
      const workspace =
        body.projectId === null || body.projectId === '@current'
          ? session.startupWorkspace
          : await registeredWorkspace(hubRoot(), body.projectId as string);
      if (session.applying) throw new RequestError(409, 'Another operation is running.');
      session.selectedWorkspace = workspace;
      session.selectedProject =
        body.projectId === '@current' ? undefined : (body.projectId as string | null);
      services.memory = session.newMemorySession();
      session.clearPreviews();
      json(200, { selected: session.selectedProject ?? null, previewsInvalidated: true });
      return true;
    }
    if (req.method === 'GET' && url.pathname === '/api/skill') {
      const result = await services.skill(
        url.searchParams.get('name') ?? '',
        url.searchParams.get('source') ?? 'hub',
      );
      json(result ? 200 : 404, result ?? { error: 'Skill not found.' });
      return true;
    }
    return false;
  };
  return handle;
}
