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
type Location = {
  key: string;
  label: string;
  kind: 'repository' | 'folder' | 'missing' | 'unverified';
  directory: string;
};

async function locate(cwd: string): Promise<Location> {
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
    return fallback((error as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : 'unverified');
  }
  try {
    // Metadata probes must not inherit another repository's Git binding or run fsmonitor hooks.
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
        env: { ...env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' },
        timeout: 1000,
        maxBuffer: 16 * 1024,
      },
    );
    const fields = stdout.trimEnd().split('\n');
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
    return fallback(
      (error as { code?: unknown }).code === 128 ? 'folder' : 'unverified',
      directory,
    );
  }
}

export function sessionDiscoveryClients(sources = adapters) {
  return sources.map(({ id, label, discoverSessions }) => ({
    id,
    label,
    supported: !!discoverSessions,
  }));
}

/** A transient read-only catalog; discovered IDs are never registered write capabilities. */
export async function discoverProjects(clients: ClientId[], sources: ClientAdapter[] = adapters) {
  if (
    !clients.length ||
    clients.length > sources.length ||
    new Set(clients).size !== clients.length ||
    clients.some((id) => !sources.some((source) => source.id === id))
  )
    throw new HubError('Choose known clients once each.');
  const reports: {
    client: ClientId;
    label: string;
    coverage: SessionScan['coverage'] | 'unsupported';
    filesRead: number;
    bytesRead: number;
    issues: string[];
  }[] = [];
  const projects = new Map<
    string,
    {
      id: string;
      label: string;
      kind: Location['kind'];
      locations: Set<string>;
      chats: Set<string>;
      clients: Set<ClientId>;
    }
  >();
  const locations = new Map<string, Location>();
  const started = Date.now();
  let limited = false;
  for (const client of clients) {
    const source = sources.find((source) => source.id === client)!;
    if (!source.discoverSessions) {
      reports.push({
        client,
        label: source.label,
        coverage: 'unsupported',
        filesRead: 0,
        bytesRead: 0,
        issues: ['Project discovery is not supported for this client yet.'],
      });
      continue;
    }
    let scan: SessionScan;
    try {
      scan = await source.discoverSessions();
    } catch {
      reports.push({
        client,
        label: source.label,
        coverage: 'unavailable',
        filesRead: 0,
        bytesRead: 0,
        issues: ['Session metadata could not be read.'],
      });
      continue;
    }
    reports.push({
      client,
      label: source.label,
      coverage: scan.coverage,
      filesRead: scan.filesRead,
      bytesRead: scan.bytesRead,
      issues: scan.issues,
    });
    for (const session of scan.sessions) {
      for (const cwd of session.locations) {
        if (!isAbsoluteLocalPath(cwd)) continue;
        let location = locations.get(cwd);
        if (!location) {
          if (locations.size >= 32 || Date.now() - started > 5000) {
            limited = true;
            location = {
              key: `folder:${cwd}`,
              label: path.basename(cwd) || cwd,
              kind: 'unverified',
              directory: cwd,
            };
          } else location = await locate(cwd);
          locations.set(cwd, location);
        }
        let project = projects.get(location.key);
        if (!project) {
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
        project.locations.add(location.directory);
        project.chats.add(`${client}:${scan.source}:${session.id}`);
        project.clients.add(client);
      }
    }
  }
  return {
    metadataOnly: true as const,
    coverage:
      !limited && reports.every((report) => report.coverage === 'complete')
        ? ('complete' as const)
        : ('partial' as const),
    sources: reports,
    issues: limited
      ? ['Some project locations were not verified because the discovery limit was reached.']
      : [],
    projects: [...projects.values()]
      .map((project) => ({
        ...project,
        locations: [...project.locations].sort(),
        chats: project.chats.size,
        clients: [...project.clients].sort(),
      }))
      .sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id)),
  };
}
