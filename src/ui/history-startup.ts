import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { applyHistoryStartup, planHistoryStartup } from '../core/history/startup.js';
import { publicManagedPlan } from '../core/recovery/managed-plan.js';
import { RequestError, type UiRequest } from './protocol.js';
import type { UiSession } from './session.js';

/** Called only after the archive route's operator token and origin checks. */
export function createHistoryStartupRoutes(session: UiSession, root: string) {
  const plans = new Map<
    string,
    { saved: Awaited<ReturnType<typeof planHistoryStartup>>; expires: number }
  >();
  session.trackPreviews(plans);
  return async (name: string, body: unknown, json: UiRequest['json']) => {
    if (name === 'startup/preview') {
      const input = z.object({ enabled: z.boolean() }).strict().safeParse(body);
      if (!input.success) throw new RequestError(400, 'Choose whether to enable login startup.');
      const saved = await planHistoryStartup(
        root,
        input.data.enabled,
        session.services.historyStartupContext,
      );
      const id = randomBytes(16).toString('hex');
      while (plans.size >= 5) plans.delete(plans.keys().next().value!);
      plans.set(id, { saved, expires: Date.now() + 5 * 60000 });
      json(200, { ...publicManagedPlan(saved.plan), id });
    } else if (name === 'startup/apply') {
      if (session.applying) throw new RequestError(409, 'Another operation is running.');
      const input = z.object({ id: z.string(), revision: z.string() }).strict().safeParse(body);
      if (!input.success) throw new RequestError(400, 'Choose a reviewed login startup plan.');
      const entry = plans.get(input.data.id);
      plans.delete(input.data.id);
      if (!entry || entry.expires < Date.now())
        throw new RequestError(409, 'Startup preview expired. Review a new plan.');
      session.applying = true;
      try {
        json(200, await applyHistoryStartup(entry.saved, input.data.revision));
      } finally {
        session.applying = false;
      }
    } else return false;
    return true;
  };
}
