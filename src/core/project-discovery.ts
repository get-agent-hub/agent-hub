import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { adapters } from '../adapters/index.js';
import type { ClientAdapter, ClientId, SessionScan } from './types.js';
import { hash } from './values.js';
import { HubError } from './errors.js';
import { isAbsoluteLocalPath } from './paths.js';

const exec = promisify(execFile);
export interface DiscoveredProject {
  id: string;
  label: string;
  kind: 'repository' | 'folder' | 'missing' | 'unverified';
  locations: string[];
  chats: number;
  clients: ClientId[];
}
export interface DiscoveryReport {
  metadataOnly: true;
  coverage: 'complete' | 'partial';
  finished?: boolean;
  checkedAt?: string;
  sources: {
    client: ClientId;
    label: string;
    coverage: SessionScan['coverage'] | 'unsupported';
    filesRead: number;
    bytesRead: number;
    issues: string[];
    entriesRead?: number;
    unresolvedFiles?: number;
    skippedFiles?: number;
    finished?: boolean;
    directory?: string;
    phase?: SessionScan['phase'];
    totalFiles?: number;
  }[];
  issues: string[];
  projects: DiscoveredProject[];
}
export interface DiscoveryControl {
  signal?: AbortSignal;
  onProgress?: (report: DiscoveryReport) => void;
}
type Location = { key: string; label: string; kind: DiscoveredProject['kind']; directory: string };

export async function verifiedProjectLocation(
  cwd: string,
  signal?: AbortSignal,
): Promise<Location> {
  signal?.throwIfAborted();
  const fallback = (kind: Location['kind'], directory = cwd): Location => ({
    key: `folder:${directory}`,
    label: path.basename(directory) || directory,
    kind,
    directory,
  });
  let directory: string;
  try {
    directory = await fs.realpath(cwd);
    if (!(await fs.stat(directory)).isDirectory()) return fallback('missing');
  } catch (error) {
    signal?.throwIfAborted();
    return fallback((error as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : 'unverified');
  }
  try {
    const env = Object.fromEntries(
      Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')),
    );
    const { stdout } = await exec(
      'git',
      [
        '-c',
        'core.fsmonitor=false',
        'rev-parse',
        '--show-toplevel',
        '--path-format=absolute',
        '--git-common-dir',
      ],
      {
        cwd: directory,
        env: { ...env, LC_ALL: 'C', LANG: 'C', GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' },
        timeout: 1000,
        maxBuffer: 16 * 1024,
        signal,
      },
    );
    // Strip the record terminator, not significant trailing spaces in a path.
    const fields = stdout.replace(/\r?\n$/, '').split('\n');
    if (fields.length !== 2 || !fields.every(isAbsoluteLocalPath))
      return fallback('unverified', directory);
    const root = await fs.realpath(fields[0]!);
    const common = await fs.realpath(fields[1]!);
    return {
      key: `git:${common}`,
      label: path.basename(path.basename(common) === '.git' ? path.dirname(common) : root),
      kind: 'repository',
      directory: root,
    };
  } catch (error) {
    signal?.throwIfAborted();
    const failure = error as { code?: unknown; stderr?: unknown };
    const ordinary =
      failure.code === 128 &&
      typeof failure.stderr === 'string' &&
      /^fatal: not a git repository\b/.test(failure.stderr);
    return fallback(ordinary ? 'folder' : 'unverified', directory);
  }
}

export function sessionDiscoveryClients(sources = adapters) {
  return sources.map(({ id, label, discoverSessions }) => ({
    id,
    label,
    supported: !!discoverSessions,
  }));
}
class CapacityReached extends Error {}

/** Transient observations only: these IDs never authorize project/memory writes. */
export async function discoverProjects(
  clients: ClientId[],
  sources: ClientAdapter[] = adapters,
  control: DiscoveryControl = {},
): Promise<DiscoveryReport> {
  if (
    !clients.length ||
    clients.length > sources.length ||
    new Set(clients).size !== clients.length ||
    clients.some((id) => !sources.some((source) => source.id === id))
  )
    throw new HubError('Choose known clients once each.');
  const reports: DiscoveryReport['sources'] = [];
  const issues = new Set<string>();
  const projects = new Map<
    string,
    Omit<DiscoveredProject, 'locations' | 'chats' | 'clients'> & {
      locations: Set<string>;
      chats: Set<string>;
      clients: Set<ClientId>;
    }
  >();
  const locations = new Map<string, Location>();
  let observations = 0;
  let limited = false;
  let finished = false;
  const view = (): DiscoveryReport => ({
    metadataOnly: true,
    coverage:
      finished &&
      !limited &&
      !issues.size &&
      reports.every((report) => report.coverage === 'complete' && report.finished !== false)
        ? 'complete'
        : 'partial',
    finished: finished && !limited && reports.every((report) => report.finished !== false),
    checkedAt: new Date().toISOString(),
    sources: reports.map((report) => ({ ...report, issues: [...report.issues] })),
    issues: [...issues],
    projects: [...projects.values()]
      .map((project) => ({
        ...project,
        locations: [...project.locations].sort(),
        chats: project.chats.size,
        clients: [...project.clients].sort(),
      }))
      .sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id)),
  });
  const progress = () => {
    control.signal?.throwIfAborted();
    control.onProgress?.(view());
  };
  for (const client of clients) {
    control.signal?.throwIfAborted();
    const source = sources.find((source) => source.id === client)!;
    const index = reports.length;
    reports.push({
      client,
      label: source.label,
      coverage: source.discoverSessions ? 'partial' : 'unsupported',
      filesRead: 0,
      bytesRead: 0,
      finished: false,
      issues: source.discoverSessions
        ? []
        : ['Project discovery is not supported for this client yet.'],
    });
    if (!source.discoverSessions) {
      reports[index]!.finished = true;
      progress();
      continue;
    }
    const receipt = (scan: SessionScan): DiscoveryReport['sources'][number] => ({
      client,
      label: source.label,
      coverage: scan.coverage,
      filesRead: scan.filesRead,
      bytesRead: scan.bytesRead,
      issues: [...scan.issues],
      entriesRead: scan.entriesRead,
      unresolvedFiles: scan.unresolvedFiles,
      skippedFiles: scan.skippedFiles,
      finished: scan.finished,
      directory: scan.directory,
      phase: scan.phase,
      totalFiles: scan.totalFiles,
    });
    let emitted = false;
    const consume = async (scan: SessionScan) => {
      control.signal?.throwIfAborted();
      reports[index] = receipt(scan);
      for (const session of scan.sessions) {
        if (!/^[a-zA-Z0-9_-]{1,128}$/.test(session.id)) continue;
        for (const cwd of session.locations) {
          control.signal?.throwIfAborted();
          if (!isAbsoluteLocalPath(cwd)) continue;
          if (++observations > 100_000) throw new CapacityReached();
          let location = locations.get(cwd);
          if (!location) {
            if (locations.size >= 5000) throw new CapacityReached();
            location = await verifiedProjectLocation(cwd, control.signal);
            locations.set(cwd, location);
            if (location.kind === 'unverified')
              issues.add(
                'Some folders could not be verified. Check Git availability and folder access, then scan again.',
              );
          }
          let project = projects.get(location.key);
          if (!project) {
            if (projects.size >= 2000) throw new CapacityReached();
            project = {
              id: `discovered:${hash(location.key).slice(0, 24)}`,
              label: location.label,
              kind: location.kind,
              locations: new Set(),
              chats: new Set(),
              clients: new Set(),
            };
            projects.set(location.key, project);
          }
          if (!project.locations.has(location.directory) && project.locations.size >= 128)
            throw new CapacityReached();
          project.locations.add(location.directory);
          project.chats.add(`${client}:${scan.source}:${session.id}`);
          project.clients.add(client);
          if (observations % 16 === 0) progress();
        }
      }
      progress();
    };
    progress();
    try {
      const result = await source.discoverSessions({
        signal: control.signal,
        onBatch: async (batch) => {
          emitted = true;
          await consume(batch);
        },
      });
      if (!emitted || result.sessions.length) await consume(result);
      else reports[index] = receipt(result);
    } catch (error) {
      control.signal?.throwIfAborted();
      if (error instanceof CapacityReached) {
        limited = true;
        issues.add(
          'The metadata view reached its supported capacity. Results are partial; remaining observations were not discarded as deletions.',
        );
        break;
      }
      reports[index] = {
        ...reports[index]!,
        coverage: 'unavailable',
        finished: true,
        issues: ['Session metadata could not be read. Check source access and scan again.'],
      };
    }
    progress();
  }
  finished = true;
  const result = view();
  control.onProgress?.(result);
  return result;
}
