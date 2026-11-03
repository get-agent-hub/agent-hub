import { HubError } from '../core/errors.js';
import http from 'node:http';
import fs from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { applyImport, planImport, publicImportPlan } from '../core/import-plan.js';
import { skillDocument, uiState } from './data.js';
import { applySync, planSync, publicSyncPlan } from '../core/sync.js';
import { runDoctor, validateDoctorOptions, type DoctorOptions } from '../core/doctor.js';
import type { DoctorReport, DoctorResult } from '../core/doctor-types.js';
import { planContent, type ContentOperation, type ContentOptions } from './content.js';
import { publicManagedPlan, applyManagedPlan } from '../core/managed-plan.js';
import type { ClientId } from '../core/types.js';
import { createMemorySession, type MemorySession } from '../core/memory-session.js';
import { hubRoot } from '../core/paths.js';
import { planQuick, applyQuick } from '../core/quick.js';

const assets = new URL('../../ui/app/', import.meta.url);
const staticFiles: Record<string, [string, string]> = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/html.js': ['html.js', 'text/javascript; charset=utf-8'],
  '/health.js': ['health.js', 'text/javascript; charset=utf-8'],
  '/content.js': ['content.js', 'text/javascript; charset=utf-8'],
  '/quick.js': ['quick.js', 'text/javascript; charset=utf-8'],
  '/memory.js': ['memory.js', 'text/javascript; charset=utf-8'],
  '/app.css': ['app.css', 'text/css; charset=utf-8'],
  '/base.css': ['base.css', 'text/css; charset=utf-8'],
};

class RequestError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function jsonBody(
  req: http.IncomingMessage,
  limit = 16 * 1024,
): Promise<Record<string, unknown>> {
  if (req.headers['content-type'] !== 'application/json')
    throw new RequestError(415, 'Expected application/json.');
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (Buffer.byteLength(body) > limit) throw new RequestError(413, 'Request is too large.');
  }
  try {
    const parsed: unknown = JSON.parse(body);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
    return parsed as Record<string, unknown>;
  } catch {
    throw new RequestError(400, 'Invalid JSON request.');
  }
}

export async function startUiServer(
  options: {
    port?: number;
    cwd?: string;
    services?: {
      quickPlan?: typeof planQuick;
      quickApply?: typeof applyQuick;
      state?: () => Promise<unknown>;
      plan?: typeof planImport;
      apply?: typeof applyImport;
      skill?: typeof skillDocument;
      syncPlan?: typeof planSync;
      syncApply?: typeof applySync;
      doctor?: typeof runDoctor;
      contentPlan?: typeof planContent;
      memory?: MemorySession;
    };
  } = {},
) {
  const services = {
    quickPlan: planQuick,
    quickApply: applyQuick,
    state: () => uiState(options.cwd ?? process.cwd()),
    plan: planImport,
    apply: applyImport,
    skill: skillDocument,
    syncPlan: planSync,
    syncApply: applySync,
    doctor: runDoctor,
    contentPlan: (operation: ContentOperation, contentOptions: ContentOptions) =>
      planContent(operation, contentOptions, options.cwd ?? process.cwd()),
    memory: createMemorySession({
      root: hubRoot(),
      workspace: options.cwd ?? process.cwd(),
      includeShared: true,
      writable: true,
      sharedWritable: true,
    }),
    ...options.services,
  };
  const token = randomBytes(32).toString('hex');
  let origin = '';
  let applying = false;
  const quickPreviews = new Map<
    string,
    { plan: Awaited<ReturnType<typeof planQuick>>; expires: number }
  >();
  const contentPreviews = new Map<
    string,
    { operation: ContentOperation; options: ContentOptions; revision: string; expires: number }
  >();
  const previews = new Map<
    string,
    { item: string; prefer: string; overwrite: boolean; revision: string; expires: number }
  >();
  const syncPreviews = new Map<
    string,
    { client?: 'dsh' | 'codex' | 'claude-code'; revision: string; expires: number }
  >();
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
      if (req.method === 'GET' && staticFiles[url.pathname]) {
        const [file, mime] = staticFiles[url.pathname];
        const body = await fs.readFile(fileURLToPath(new URL(file, assets)));
        res.writeHead(200, { 'Content-Type': mime });
        res.end(body);
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/state') {
        json(200, { ...((await services.state()) as object), token });
        return;
      }
      if (
        req.method === 'POST' &&
        ['/api/quick/preview', '/api/quick/apply'].includes(url.pathname)
      ) {
        if (req.headers['x-agent-hub-token'] !== token)
          throw new RequestError(403, 'Refresh the page before running quick setup.');
        if (applying) throw new RequestError(409, 'Another operation is running.');
        const body = await jsonBody(req);
        if (applying) throw new RequestError(409, 'Another operation is running.');
        if (url.pathname.endsWith('/preview')) {
          if (
            body.clients !== undefined &&
            (!Array.isArray(body.clients) || body.clients.some((id) => typeof id !== 'string'))
          )
            throw new RequestError(400, 'Choose known clients.');
          if (
            (body.prefer !== undefined && typeof body.prefer !== 'string') ||
            ['project', 'automation'].some(
              (key) => body[key] !== undefined && typeof body[key] !== 'boolean',
            )
          )
            throw new RequestError(400, 'Invalid quick setup options.');
          const plan = await services.quickPlan({
            workspace: options.cwd ?? process.cwd(),
            clients: body.clients as ClientId[] | undefined,
            prefer: body.prefer as ClientId | undefined,
            project: body.project as boolean | undefined,
            automation: body.automation as boolean | undefined,
          });
          for (const [id, saved] of quickPreviews)
            if (saved.expires < Date.now()) quickPreviews.delete(id);
          while (quickPreviews.size >= 10) quickPreviews.delete(quickPreviews.keys().next().value!);
          const id = randomBytes(16).toString('hex');
          quickPreviews.set(id, { plan, expires: Date.now() + 5 * 60_000 });
          json(200, { ...plan.publicPlan, previewId: id });
          return;
        }
        const id = typeof body.previewId === 'string' ? body.previewId : '';
        const saved = quickPreviews.get(id);
        quickPreviews.delete(id);
        if (
          !saved ||
          saved.expires < Date.now() ||
          body.revision !== saved.plan.publicPlan.revision
        )
          throw new RequestError(
            409,
            'Quick preview expired or was already used. Run a new preview.',
          );
        applying = true;
        try {
          json(200, await services.quickApply(saved.plan, saved.plan.publicPlan.revision));
        } finally {
          applying = false;
        }
        return;
      }
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
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/memory/automation') {
        json(200, await services.memory.automation());
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/memory/conflict') {
        json(200, await services.memory.conflict(url.searchParams.get('id') ?? ''));
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/memory/discovery') {
        json(200, await services.memory.discover());
        return;
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
        if (applying) throw new RequestError(409, 'Another operation is running.');
        const body = await jsonBody(req, 160 * 1024);
        if (applying) throw new RequestError(409, 'Another operation is running.');
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
        } else if (url.pathname.endsWith('/preview'))
          json(200, await services.memory.preview(body));
        else {
          if (
            Object.keys(body).some((key) => !['id', 'revision'].includes(key)) ||
            typeof body.id !== 'string' ||
            typeof body.revision !== 'string'
          )
            throw new RequestError(400, 'A preview ID and revision are required.');
          applying = true;
          try {
            json(200, await services.memory.apply(body.id, body.revision));
          } finally {
            applying = false;
          }
        }
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/skill') {
        const result = await services.skill(
          url.searchParams.get('name') ?? '',
          url.searchParams.get('source') ?? 'hub',
        );
        json(result ? 200 : 404, result ?? { error: 'Skill not found.' });
        return;
      }
      if (req.method === 'GET' && /^\/api\/doctor\/[a-f0-9]{32}$/.test(url.pathname)) {
        const job = doctorJobs.get(url.pathname.split('/').pop()!);
        json(
          job ? 200 : 404,
          job ? doctorView(job) : { error: 'Check not found. Run a new check.' },
        );
        return;
      }
      if (
        req.method === 'POST' &&
        ['/api/doctor/run', '/api/doctor/cancel'].includes(url.pathname)
      ) {
        if (req.headers['x-agent-hub-token'] !== token)
          throw new RequestError(403, 'Refresh the page before starting a check.');
        const body = await jsonBody(req);
        if (url.pathname.endsWith('/cancel')) {
          const job = doctorJobs.get(typeof body.id === 'string' ? body.id : '');
          if (!job) throw new RequestError(404, 'Check not found.');
          job.controller.abort();
          json(200, doctorView(job));
          return;
        }
        if ([...doctorJobs.values()].some((j) => j.state === 'running'))
          throw new RequestError(
            409,
            'A check is already running. Wait for it or cancel it first.',
          );
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
        return;
      }
      if (
        req.method === 'POST' &&
        ['/api/sync/preview', '/api/sync/apply'].includes(url.pathname)
      ) {
        if (req.headers['x-agent-hub-token'] !== token)
          throw new RequestError(403, 'Refresh the page before making changes.');
        if (applying) throw new RequestError(409, 'Another operation is running.');
        const body = await jsonBody(req);
        if (applying) throw new RequestError(409, 'Another operation is running.');
        if (url.pathname.endsWith('/preview')) {
          if (
            body.client !== undefined &&
            !['dsh', 'codex', 'claude-code'].includes(String(body.client))
          )
            throw new RequestError(400, 'Choose a known client.');
          const client = body.client as 'dsh' | 'codex' | 'claude-code' | undefined;
          const plan = await services.syncPlan({ client });
          const id = randomBytes(16).toString('hex');
          for (const [key, p] of syncPreviews) if (p.expires < Date.now()) syncPreviews.delete(key);
          if (syncPreviews.size >= 50) syncPreviews.delete(syncPreviews.keys().next().value!);
          syncPreviews.set(id, {
            client,
            revision: plan.revision,
            expires: Date.now() + 5 * 60_000,
          });
          json(200, { id, ...publicSyncPlan(plan) });
          return;
        }
        const id = typeof body.id === 'string' ? body.id : '';
        const preview = syncPreviews.get(id);
        if (!preview || preview.expires < Date.now())
          throw new RequestError(409, 'Preview expired. Run a new dry run.');
        applying = true;
        try {
          const plan = await services.syncPlan({ client: preview.client });
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
          applying = false;
        }
        return;
      }
      if (
        req.method === 'POST' &&
        ['/api/import/preview', '/api/import/apply'].includes(url.pathname)
      ) {
        if (req.headers['x-agent-hub-token'] !== token)
          throw new RequestError(403, 'Refresh the page before making changes.');
        if (applying) throw new RequestError(409, 'An import is already running.');
        const body = await jsonBody(req);
        if (applying) throw new RequestError(409, 'An import is already running.');
        if (url.pathname.endsWith('/preview')) {
          const item = typeof body.item === 'string' ? body.item : 'mcp';
          if (item !== 'mcp' && !/^mcp:.{1,200}$/.test(item))
            throw new RequestError(400, 'Choose MCP servers to import.');
          const prefer = typeof body.prefer === 'string' ? body.prefer : 'claude-code,codex,dsh';
          if (!/^(claude-code|codex|dsh)(,(claude-code|codex|dsh))*$/.test(prefer))
            throw new RequestError(400, 'Unknown source client.');
          const overwrite = body.overwrite === true;
          const plan = await services.plan(item, { prefer, overwrite });
          const id = randomBytes(16).toString('hex');
          for (const [key, p] of previews) if (p.expires < Date.now()) previews.delete(key);
          if (previews.size >= 50) previews.delete(previews.keys().next().value!);
          previews.set(id, {
            item,
            prefer,
            overwrite,
            revision: plan.revision,
            expires: Date.now() + 5 * 60_000,
          });
          json(200, { id, ...publicImportPlan(plan) });
          return;
        }
        const id = typeof body.id === 'string' ? body.id : '';
        const preview = previews.get(id);
        if (!preview || preview.expires < Date.now())
          throw new RequestError(409, 'Preview expired. Review the import again.');
        applying = true;
        try {
          const plan = await services.plan(preview.item, preview);
          if (plan.revision !== preview.revision)
            throw new RequestError(
              409,
              'Configuration changed since preview. Review the import again.',
            );
          previews.delete(id);
          json(200, await services.apply(plan));
        } finally {
          applying = false;
        }
        return;
      }
      if (
        req.method === 'POST' &&
        ['/api/content/preview', '/api/content/apply'].includes(url.pathname)
      ) {
        if (req.headers['x-agent-hub-token'] !== token)
          throw new RequestError(403, 'Refresh the page before making changes.');
        if (applying) throw new RequestError(409, 'Another operation is running.');
        const body = await jsonBody(req);
        if (applying) throw new RequestError(409, 'Another operation is running.');
        if (url.pathname.endsWith('/preview')) {
          const operation = body.operation as ContentOperation;
          const contentOptions: ContentOptions = {
            client: body.client as ClientId | undefined,
            prefer: body.prefer as string | undefined,
            overwrite: body.overwrite as boolean | undefined,
            replace: body.replace as string[] | undefined,
          };
          if (contentOptions.prefer !== undefined && typeof contentOptions.prefer !== 'string')
            throw new RequestError(400, 'Choose a known source preference.');
          const plan = await services.contentPlan(operation, contentOptions);
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
          return;
        }
        const id = typeof body.id === 'string' ? body.id : '';
        const preview = contentPreviews.get(id);
        if (!preview || preview.expires < Date.now())
          throw new RequestError(409, 'Preview expired. Review a new plan.');
        applying = true;
        try {
          const rebuild = () => services.contentPlan(preview.operation, preview.options);
          const plan = await rebuild();
          if (plan.revision !== preview.revision || plan.blocked)
            throw new RequestError(
              409,
              'Inputs changed or the plan is blocked. Review a new plan.',
            );
          contentPreviews.delete(id);
          json(200, await applyManagedPlan(plan, rebuild, preview.revision));
        } finally {
          applying = false;
        }
        return;
      }
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
      for (const job of doctorJobs.values()) job.controller.abort();
      await Promise.allSettled([...doctorJobs.values()].map((job) => job.task));
      await new Promise<void>((resolve, reject) => {
        server.close((e) => (e ? reject(e) : resolve()));
        server.closeIdleConnections();
      });
    },
  };
}
