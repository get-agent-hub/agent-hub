import { z } from 'zod';
import { randomBytes } from 'node:crypto';
import { CLIENT_IDS } from '../../contracts/clients.js';
import { planHistoryConnection, applyHistoryConnection } from '../../core/history/connection.js';
import { historySources } from '../../adapters/history/sources.js';
import { historyOverview } from '../../core/history/overview.js';
import { applyHistoryPolicy, planHistoryPolicy } from '../../core/history/policy.js';
import {
  historyBytes,
  listHistory,
  readConversation,
  readHistoryEvent,
  searchHistory,
} from '../../core/history/query.js';
import { rebuildHistory } from '../../core/history/rebuild.js';
import { hubRoot } from '../../shared/paths.js';
import { createHistoryJobs } from '../history-jobs.js';
import { RequestError, jsonBody, type UiRoute } from '../protocol.js';
import type { UiSession } from '../session.js';

const query = z
  .object({
    query: z.string().max(500).optional(),
    client: z.string().optional(),
    project: z.string().optional(),
    offset: z.number().int().nonnegative().optional(),
    limit: z.number().int().min(1).max(100).optional(),
    view: z.enum(['events', 'conversation']).optional(),
    sort: z.enum(['newest', 'oldest']).optional(),
  })
  .strict();
const conversation = query.extend({ id: z.string(), revision: z.string().optional() });
const event = z
  .object({
    id: z.string(),
    ordinal: z.number().int().nonnegative(),
    offset: z.number().int().nonnegative().optional(),
    revision: z.string().optional(),
  })
  .strict();
const bytes = z
  .object({
    id: z.string(),
    revision: z.string().optional(),
    asset: z.string().optional(),
    offset: z.number().int().nonnegative().optional(),
  })
  .strict();
const operator = { operator: true } as const;

export function createHistoryRoutes(session: UiSession) {
  const root = hubRoot();
  const sources = session.services.historySources ?? historySources;
  const jobs = createHistoryJobs(root, (running) => {
    session.applying = running;
  });
  const connections = new Map<
    string,
    { plan: Awaited<ReturnType<typeof planHistoryConnection>>; expires: number }
  >();
  session.trackPreviews(connections);
  const handle: UiRoute = async ({ req, url, json }) => {
    if (!url.pathname.startsWith('/api/history/')) return false;
    if (req.method !== 'POST')
      throw new RequestError(405, 'History reads require a session-authenticated request.');
    if (req.headers['x-agent-hub-token'] !== session.token)
      throw new RequestError(403, 'Refresh the page before accessing history.');
    const body = await jsonBody(req);
    const name = url.pathname.slice('/api/history/'.length);
    if (name === 'status')
      json(200, {
        ...(await historyOverview(root, operator)),
        sources: await sources(),
        job: jobs.status(),
      });
    else if (name === 'list') json(200, await listHistory(root, operator, validated(query, body)));
    else if (name === 'search')
      json(200, await searchHistory(root, operator, validated(query, body)));
    else if (name === 'read') {
      const input = validated(conversation, body);
      json(200, await readConversation(root, operator, input.id, input));
    } else if (name === 'event') {
      const input = validated(event, body);
      json(
        200,
        await readHistoryEvent(
          root,
          operator,
          input.id,
          input.ordinal,
          input.offset,
          input.revision,
        ),
      );
    } else if (name === 'bytes') {
      const input = validated(bytes, body);
      json(200, await historyBytes(root, operator, input.id, input));
    } else if (name === 'job') json(200, jobs.status());
    else if (name === 'cancel') json(200, jobs.cancel());
    else if (name === 'scan') {
      if (session.applying) throw new RequestError(409, 'Another operation is running.');
      const input = validated(z.object({ sources: z.array(z.string()).min(1) }).strict(), body);
      const available = await sources();
      if (input.sources.some((id) => !available.some((source) => source.id === id)))
        throw new RequestError(400, 'Choose known native history sources.');
      if (session.applying) throw new RequestError(409, 'Another operation is running.');
      json(202, jobs.start(available.filter((source) => input.sources.includes(source.id))));
    } else if (name === 'connection/preview') {
      const input = validated(
        z.object({ project: z.string(), clients: z.array(z.enum(CLIENT_IDS)).optional() }).strict(),
        body,
      );
      const plan = await planHistoryConnection(
        root,
        input.project,
        input.clients,
        await session.services.historySyncContext?.(),
      );
      const id = randomBytes(16).toString('hex');
      while (connections.size >= 5) connections.delete(connections.keys().next().value!);
      connections.set(id, { plan, expires: Date.now() + 5 * 60000 });
      json(200, { ...plan.publicPlan, id });
    } else if (name === 'connection/apply') {
      if (session.applying) throw new RequestError(409, 'Another operation is running.');
      const input = validated(z.object({ id: z.string(), revision: z.string() }).strict(), body);
      const saved = connections.get(input.id);
      connections.delete(input.id);
      if (!saved || saved.expires < Date.now())
        throw new RequestError(409, 'Connection preview expired. Review a new plan.');
      session.applying = true;
      try {
        json(200, await applyHistoryConnection(saved.plan, input.revision));
      } finally {
        session.applying = false;
      }
    } else if (name === 'policy/preview') {
      const plan = await planHistoryPolicy(root, body);
      json(200, { revision: plan.revision, change: plan.change, note: plan.note });
    } else if (name === 'policy/apply' || name === 'rebuild') {
      if (session.applying) throw new RequestError(409, 'Another operation is running.');
      session.applying = true;
      try {
        if (name === 'rebuild') json(200, await rebuildHistory(root));
        else {
          const input = validated(
            z.object({ change: z.unknown(), revision: z.string() }).strict(),
            body,
          );
          json(200, await applyHistoryPolicy(root, input.change, input.revision));
        }
      } finally {
        session.applying = false;
      }
    } else throw new RequestError(404, 'History operation not found.');
    return true;
  };
  return { handle, close: jobs.close };
}
function validated<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new RequestError(400, 'Invalid history request.');
  return result.data;
}
