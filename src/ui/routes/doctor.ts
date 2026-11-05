import { randomBytes } from 'node:crypto';
import { validateDoctorOptions, type DoctorOptions } from '../../core/diagnostics/doctor.js';
import type { DoctorReport, DoctorResult } from '../../core/diagnostics/types.js';
import { HubError } from '../../shared/errors.js';
import { RequestError, jsonBody, type UiRoute } from '../protocol.js';
import type { UiSession } from '../session.js';

export function createDoctorRoutes(session: UiSession) {
  const { services, token } = session;
  type DoctorJob = {
    id: string;
    state: 'running' | 'done' | 'failed';
    startedAt: string;
    results: DoctorResult[];
    report?: DoctorReport;
    error?: string;
    controller: AbortController;
    task: Promise<void>;
  };
  const doctorJobs = new Map<string, DoctorJob>();
  const doctorView = (job: DoctorJob) => ({
    id: job.id,
    state: job.state,
    startedAt: job.startedAt,
    results: job.results,
    report: job.report,
    error: job.error,
  });

  const handle: UiRoute = async ({ req, url, json }) => {
    if (req.method === 'GET' && /^\/api\/doctor\/[a-f0-9]{32}$/.test(url.pathname)) {
      const job = doctorJobs.get(url.pathname.split('/').pop()!);
      json(job ? 200 : 404, job ? doctorView(job) : { error: 'Check not found. Run a new check.' });
      return true;
    }
    if (req.method === 'POST' && ['/api/doctor/run', '/api/doctor/cancel'].includes(url.pathname)) {
      if (req.headers['x-agent-hub-token'] !== token)
        throw new RequestError(403, 'Refresh the page before starting a check.');
      const body = await jsonBody(req);
      if (url.pathname.endsWith('/cancel')) {
        const job = doctorJobs.get(typeof body.id === 'string' ? body.id : '');
        if (!job) throw new RequestError(404, 'Check not found.');
        job.controller.abort();
        json(200, doctorView(job));
        return true;
      }
      if ([...doctorJobs.values()].some((j) => j.state === 'running'))
        throw new RequestError(409, 'A check is already running. Wait for it or cancel it first.');
      if (
        body.name !== undefined &&
        (typeof body.name !== 'string' || !body.name || body.name.length > 200)
      )
        throw new RequestError(400, 'Choose a server from the hub registry.');
      if (body.client !== undefined && typeof body.client !== 'string')
        throw new RequestError(400, 'Choose a known client.');
      if (body.timeout !== undefined && typeof body.timeout !== 'number')
        throw new RequestError(400, 'Timeout must be a number of seconds.');
      const opts: DoctorOptions = {
        name: body.name as string | undefined,
        client: body.client as DoctorOptions['client'],
        timeout: body.timeout as number | undefined,
      };
      validateDoctorOptions(opts);
      if (doctorJobs.size >= 20) doctorJobs.delete(doctorJobs.keys().next().value!);
      const id = randomBytes(16).toString('hex');
      const job: DoctorJob = {
        id,
        state: 'running',
        startedAt: new Date().toISOString(),
        results: [],
        controller: new AbortController(),
        task: Promise.resolve(),
      };
      doctorJobs.set(id, job);
      job.task = services
        .doctor(opts, undefined, {
          signal: job.controller.signal,
          onResult: (result) => {
            job.results.push(result);
          },
        })
        .then((report) => {
          job.report = report;
          job.results = report.results;
          job.state = 'done';
        })
        .catch((error) => {
          job.error =
            error instanceof HubError
              ? error.message
              : 'The check could not finish. Check your hub configuration and retry.';
          job.state = 'failed';
        });
      json(202, doctorView(job));
      return true;
    }
    return false;
  };
  return {
    handle,
    close: async () => {
      for (const job of doctorJobs.values()) job.controller.abort();
      await Promise.allSettled([...doctorJobs.values()].map((job) => job.task));
    },
  };
}
