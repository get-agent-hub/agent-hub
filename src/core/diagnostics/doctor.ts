import { constants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { appManaged, reservedSkill } from '../../adapters/policies.js';
import type { ClientId } from '../../contracts/clients.js';
import { serviceHealthCheck } from '../../integrations/health-checks.js';
import { HubError } from '../../shared/errors.js';
import { writeAtomic } from '../../shared/file-store.js';
import { listSkills } from '../../shared/fs.js';
import { withHubLock } from '../../shared/hub-lock.js';
import { clientPaths, hubRoot } from '../../shared/paths.js';
import { cliPath } from '../../shared/runtime.js';
import { hubCommand } from '../../shared/shell.js';
import { hash, stableStringify as stable } from '../../shared/values.js';
import { readEnvFile } from '../configuration/env.js';
import type { HubServer, Registry } from '../configuration/registry.js';
import { parseRegistry } from '../configuration/registry.js';
import { buildLaunch } from '../mcp/launch.js';
import { ensureBaseline } from '../recovery/baseline.js';
import { probe } from './probe.js';
import { checkService } from './service.js';
import type { DoctorContext } from './types.js';
import {
  classifyFailure,
  failure,
  type DoctorCheck,
  type DoctorReport,
  type DoctorResult,
  type ProbeResult,
} from './types.js';
export type { DoctorContext } from './types.js';

export interface DoctorOptions {
  name?: string;
  client?: ClientId;
  timeout?: number;
  concurrency?: number;
  save?: boolean;
}
interface DoctorControl {
  signal?: AbortSignal;
  onResult?: (result: DoctorResult) => void;
}

function summarize(results: DoctorResult[], checks: DoctorCheck[]) {
  const summary = {
    ok: 0,
    failed: 0,
    skipped: 0,
    cancelled: 0,
    warnings: checks.filter((c) => c.status === 'warn').length,
  };
  for (const result of results) {
    summary[result.status]++;
    if (result.service && result.service.status !== 'ready') summary.warnings++;
  }
  return summary;
}
export const defaultDoctorContext = (): DoctorContext => ({
  root: path.resolve(hubRoot()),
  node: process.execPath,
  cli: cliPath,
  worker: fileURLToPath(new URL('../../../dist/workers/doctor.js', import.meta.url)),
  skillRoots: [
    { client: 'hub', path: path.join(hubRoot(), 'skills') },
    { client: 'claude-code', path: path.join(clientPaths.claudeHome(), 'skills') },
    { client: 'codex/dsh', path: clientPaths.agentsSkills() },
    ...(clientPaths.dshSkills() !== clientPaths.agentsSkills()
      ? [{ client: 'dsh-shared', path: clientPaths.dshSkills() }]
      : []),
    { client: 'codex', path: path.join(clientPaths.codexHome(), 'skills') },
    { client: 'dsh', path: path.join(clientPaths.dshHome(), 'skills') },
  ],
});

export function validateDoctorOptions(options: DoctorOptions) {
  if (options.client && !['dsh', 'codex', 'claude-code'].includes(options.client))
    throw new HubError('Choose dsh, codex or claude-code.');
  if (
    options.timeout !== undefined &&
    (!Number.isFinite(options.timeout) || options.timeout < 0.1 || options.timeout > 120)
  )
    throw new HubError('Timeout must be between 0.1 and 120 seconds.');
  if (
    options.concurrency !== undefined &&
    (!Number.isInteger(options.concurrency) || options.concurrency < 1 || options.concurrency > 4)
  )
    throw new HubError('Concurrency must be between 1 and 4.');
}

async function inputs(context: DoctorContext) {
  let registry: Registry;
  let raw: string;
  try {
    raw = await fs.readFile(path.join(context.root, 'mcp', 'servers.yaml'), 'utf8');
    registry = parseRegistry(raw);
  } catch {
    throw new HubError(
      'Cannot read the MCP registry. Initialize the hub and check mcp/servers.yaml.',
    );
  }
  const env = await readEnvFile(path.join(context.root, '.env'));
  const refs = [...raw.matchAll(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g)].map((m) => m[1]);
  const revision = hash(
    stable({
      raw,
      env: [...env],
      inherited: refs.map((name) => [name, process.env[name]]),
      cli: context.cli,
    }),
  );
  return { registry, env, revision };
}

async function localChecks(context: DoctorContext): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [];
  try {
    const mode = (await fs.stat(path.join(context.root, '.env'))).mode & 0o777;
    checks.push({
      name: '.env',
      status: mode & 0o077 ? 'warn' : 'ok',
      message:
        mode & 0o077
          ? `File permissions are ${mode.toString(8)}; use 600 for private credentials.`
          : 'Credentials file is private.',
    });
  } catch {
    checks.push({
      name: '.env',
      status: 'warn',
      message: 'Credentials file is missing or unreadable.',
    });
  }
  for (const [label, file] of [
    ['launcher', context.cli],
    ['doctor worker', context.worker],
  ]) {
    try {
      await fs.access(file);
      checks.push({ name: label, status: 'ok', message: 'Built entry point is available.' });
    } catch {
      checks.push({
        name: label,
        status: 'failed',
        message: 'Built entry point is missing. Run npm run build.',
      });
    }
  }
  for (const root of context.skillRoots) {
    for (const skill of await listSkills(root.path)) {
      if (reservedSkill(root.client, skill.name)) continue;
      if (!skill.realPath || !skill.hasSkillMd)
        checks.push({
          name: `skill:${root.client}:${skill.name}`,
          status: 'warn',
          message: skill.realPath ? 'Directory has no SKILL.md.' : 'Skill link is broken.',
        });
    }
  }
  return checks;
}

async function executable(command: string, cwd: string | undefined, envPath: string) {
  const paths =
    command.includes('/') || command.includes('\\')
      ? [path.resolve(cwd ?? process.cwd(), command)]
      : envPath.split(path.delimiter).map((p) => path.resolve(p || cwd || process.cwd(), command));
  let permission = false;
  for (const file of paths) {
    try {
      if ((await fs.stat(file)).isFile()) {
        await fs.access(file, constants.X_OK);
        return;
      }
    } catch (e) {
      if (['EACCES', 'EPERM'].includes((e as NodeJS.ErrnoException).code ?? '')) permission = true;
    }
  }
  throw Object.assign(new Error(permission ? 'EACCES' : 'ENOENT'), {
    code: permission ? 'EACCES' : 'ENOENT',
  });
}

function skipReason(server: HubServer, options: DoctorOptions) {
  if (appManaged(server)) return 'Managed by its application; check it in that application.';
  if (options.client && server.only && !server.only.includes(options.client))
    return `Not in ${options.client} scope.`;
  if (options.client && server.clients?.[options.client]?.enabled === false)
    return `Disabled for ${options.client}.`;
  if (server.only?.length && server.only.every((id) => server.clients?.[id]?.enabled === false))
    return 'Disabled for all clients in its scope.';
  return undefined;
}

export async function runDoctor(
  options: DoctorOptions = {},
  context = defaultDoctorContext(),
  control: DoctorControl = {},
): Promise<DoctorReport> {
  validateDoctorOptions(options);
  const input = await inputs(context);
  const servers = Object.entries(input.registry.servers)
    .sort(([a], [b]) => a.localeCompare(b))
    .filter(([name]) => !options.name || name === options.name);
  if (options.name && !servers.length)
    throw new HubError('That server is not in the hub registry.');
  const started = Date.now();
  const checks = await localChecks(context);
  if (!servers.length)
    checks.push({ name: 'registry', status: 'warn', message: 'No MCP servers are registered.' });
  const results: DoctorResult[] = [];
  const finish = (name: string, since: number, result: ProbeResult) => {
    const full = {
      ...result,
      name,
      durationMs: Date.now() - since,
      checkedAt: new Date().toISOString(),
    };
    results.push(full);
    control.onResult?.(full);
  };
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(options.concurrency ?? 2, servers.length) }, async () => {
      while (next < servers.length) {
        const [name, server] = servers[next++];
        const since = Date.now();
        if (control.signal?.aborted) {
          finish(name, since, { status: 'cancelled', phase: 'preflight', tools: null });
          continue;
        }
        try {
          if (
            server.only !== undefined &&
            (!Array.isArray(server.only) ||
              server.only.some((id) => !['dsh', 'codex', 'claude-code'].includes(id)))
          )
            throw new Error('Invalid client scope');
          const skipped = skipReason(server, options);
          if (skipped) {
            finish(name, since, {
              status: 'skipped',
              phase: 'preflight',
              tools: null,
              note: skipped,
            });
            continue;
          }
          const launch = buildLaunch(server, input.env);
          if (launch.missing.size) {
            finish(name, since, {
              status: 'failed',
              phase: 'preflight',
              tools: null,
              error: failure('missing-env'),
            });
            continue;
          }
          if (checks.some((c) => c.status === 'failed')) {
            finish(name, since, {
              status: 'failed',
              phase: 'preflight',
              tools: null,
              error: failure('config'),
            });
            continue;
          }
          if (launch.cwd && !(await fs.stat(launch.cwd)).isDirectory())
            throw new Error('Invalid working directory');
          await executable(launch.command, launch.cwd, launch.env.PATH ?? process.env.PATH ?? '');
          const timeoutMs = (options.timeout ?? 20) * 1000;
          const [result, service] = await Promise.all([
            probe(name, timeoutMs, context, control.signal),
            checkService(
              serviceHealthCheck(server, launch.env, input.env),
              timeoutMs,
              control.signal,
            ),
          ]);
          finish(name, since, { ...result, ...(service ? { service } : {}) });
        } catch (e) {
          const code = (e as NodeJS.ErrnoException).code;
          finish(name, since, {
            status: 'failed',
            phase: 'preflight',
            tools: null,
            error: code ? classifyFailure(e) : failure('config'),
          });
        }
      }
    }),
  );
  const command = hubCommand(context, [
    'doctor',
    ...(options.name ? [options.name] : []),
    ...(options.client ? ['--client', options.client] : []),
    '--timeout',
    String(options.timeout ?? 20),
  ]);
  const summary = summarize(results, checks);
  const report: DoctorReport = {
    version: 1,
    revision: input.revision,
    startedAt: new Date(started).toISOString(),
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - started,
    scope: { name: options.name, client: options.client },
    checks,
    results: results.sort((a, b) => a.name.localeCompare(b.name)),
    summary,
    command,
  };
  if (options.save !== false) {
    const dir = path.join(context.root, 'state');
    try {
      await withHubLock(context.root, async (origin) => {
        await ensureBaseline(context.root, [], origin);
        let previous: DoctorReport | undefined;
        try {
          previous = JSON.parse(await fs.readFile(path.join(dir, 'doctor.json'), 'utf8'));
        } catch {
          /* first report */
        }
        const combined = new Map<string, DoctorResult>();
        if (
          previous?.version === 1 &&
          previous.revision === report.revision &&
          previous.scope?.client === report.scope.client &&
          Array.isArray(previous.results)
        ) {
          for (const result of previous.results) combined.set(result.name, result);
        }
        for (const result of report.results) combined.set(result.name, result);
        const cachedResults = [...combined.values()].sort((a, b) => a.name.localeCompare(b.name));
        const cachedReport = {
          ...report,
          scope: { client: report.scope.client },
          results: cachedResults,
          summary: summarize(cachedResults, checks),
        };
        await writeAtomic(
          path.join(dir, 'doctor.json'),
          JSON.stringify(cachedReport, null, 2) + '\n',
          0o600,
        );
      });
    } catch {
      report.saveWarning = 'The report could not be saved. Check hub state directory permissions.';
    }
  }
  return report;
}

export async function cachedDoctor(context = defaultDoctorContext()) {
  try {
    const report = JSON.parse(
      await fs.readFile(path.join(context.root, 'state', 'doctor.json'), 'utf8'),
    ) as DoctorReport;
    if (report.version !== 1 || !Array.isArray(report.results) || !report.summary) return null;
    const current = await inputs(context);
    return { report, stale: current.revision !== report.revision };
  } catch {
    return null;
  }
}
