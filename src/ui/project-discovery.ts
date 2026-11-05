import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import { promisify } from 'node:util';
import type { ClientId } from '../contracts/clients.js';
import type { DiscoveryControl, DiscoveryReport } from '../core/projects/discovery.js';
import { HubError } from '../shared/errors.js';

const exec = promisify(execFile);
const empty = (): DiscoveryReport => ({
  metadataOnly: true,
  coverage: 'partial',
  sources: [],
  issues: [],
  projects: [],
});
type Job = {
  id: string;
  clients: ClientId[];
  state: 'running' | 'complete' | 'cancelled' | 'failed';
  startedAt: string;
  report: DiscoveryReport;
  previous?: DiscoveryReport;
  error?: string;
  controller: AbortController;
  done: Promise<void>;
  finish: () => void;
};

export async function revealDirectory(directory: string) {
  if (process.platform === 'darwin') await exec('open', ['-R', directory], { timeout: 5000 });
  else if (process.platform === 'linux') await exec('xdg-open', [directory], { timeout: 5000 });
  else
    throw new HubError(
      'Revealing folders is not verified on this platform. Copy the folder path instead.',
    );
}

/** One ephemeral operator job, with bounded cached results and no installed worker/service. */
export function createDiscoveryJobs(
  run: (clients: ClientId[], control: DiscoveryControl) => Promise<DiscoveryReport>,
  reveal = revealDirectory,
) {
  const jobs = new Map<string, Job>();
  let latest: Job | undefined;
  let pendingReads = 0;
  const merged = (job: Job) => {
    const previous = job.report.coverage !== 'complete' ? job.previous : undefined;
    const rows = new Map(
      job.report.projects.map((project) => [project.id, { ...project, previous: false }]),
    );
    let omitted = 0;
    for (const project of previous?.projects ?? []) {
      if (rows.has(project.id)) continue;
      if (rows.size >= 2000) {
        omitted++;
        continue;
      }
      rows.set(project.id, { ...project, previous: true });
    }
    return {
      rows: [...rows.values()].sort(
        (a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id),
      ),
      previousAt: previous?.checkedAt,
      omitted,
    };
  };
  const find = (id?: string) => {
    const job = id ? jobs.get(id) : latest;
    if (!job) throw new HubError('No retained scan with this ID. Start a new project scan.');
    return job;
  };
  const cancel = (job: Job, reason = 'Scan stopped. Previously found results are retained.') => {
    if (job.state !== 'running') return;
    job.state = 'cancelled';
    job.error = reason;
    job.controller.abort();
    job.report = { ...job.report, coverage: 'partial', finished: false };
    job.finish();
  };
  return {
    currentId() {
      return latest?.id;
    },
    start(clients: ClientId[]) {
      clients = [...clients].sort();
      if (latest?.state === 'running') {
        if (JSON.stringify(latest.clients) === JSON.stringify(clients)) return latest.id;
        throw new HubError(
          'Another source selection is being scanned. Stop it before changing clients.',
        );
      }
      if (pendingReads >= 2)
        throw new HubError(
          'Stopped filesystem reads are still closing. Wait for them or restart the local interface.',
        );
      let finish!: () => void;
      const done = new Promise<void>((resolve) => {
        finish = resolve;
      });
      const previous =
        latest && JSON.stringify(latest.clients) === JSON.stringify(clients)
          ? {
              ...latest.report,
              checkedAt: latest.report.checkedAt ?? latest.previous?.checkedAt,
              projects: merged(latest).rows,
            }
          : undefined;
      const job: Job = {
        id: randomBytes(16).toString('hex'),
        clients,
        state: 'running',
        startedAt: new Date().toISOString(),
        report: empty(),
        previous,
        controller: new AbortController(),
        done,
        finish,
      };
      latest = job;
      jobs.set(job.id, job);
      while (jobs.size > 2) jobs.delete(jobs.keys().next().value!);
      pendingReads++;
      const timer = setTimeout(
        () =>
          cancel(
            job,
            'Scan stopped after its time limit. Results are partial; start again when the source is available.',
          ),
        10 * 60_000,
      );
      timer.unref();
      void Promise.resolve()
        .then(() => {
          job.controller.signal.throwIfAborted();
          return run(clients, {
            signal: job.controller.signal,
            onProgress(report) {
              job.controller.signal.throwIfAborted();
              if (job.state === 'running') job.report = report;
            },
          });
        })
        .then(
          (report) => {
            if (job.state !== 'running') return;
            job.report = { ...report, checkedAt: report.checkedAt ?? new Date().toISOString() };
            job.state = 'complete';
          },
          () => {
            if (job.state !== 'running') return;
            job.state = 'failed';
            job.error = 'Project discovery could not finish. Check source access and try again.';
          },
        )
        .finally(() => {
          clearTimeout(timer);
          pendingReads--;
          job.finish();
        });
      return job.id;
    },
    status(id?: string, offset = 0, query = '') {
      const job = find(id);
      const known = merged(job);
      const matches = known.rows.filter((project) =>
        [project.label, ...project.locations].join(' ').toLowerCase().includes(query.toLowerCase()),
      );
      const rows = [];
      let bytes = 0;
      let next = Math.min(offset, matches.length);
      while (next < matches.length && rows.length < 100) {
        const project = matches[next]!;
        const row = {
          ...project,
          locations: project.locations.slice(0, 5),
          locationCount: project.locations.length,
        };
        const size = Buffer.byteLength(JSON.stringify(row));
        if (rows.length && bytes + size > 128 * 1024) break;
        rows.push(row);
        bytes += size;
        next++;
      }
      return {
        id: job.id,
        state: job.state,
        startedAt: job.startedAt,
        error: job.error,
        clients: job.clients,
        ...job.report,
        projects: rows,
        total: known.rows.length,
        matches: matches.length,
        offset,
        nextOffset: next < matches.length ? next : null,
        previousAt: known.previousAt,
        previousOmitted: known.omitted,
      };
    },
    async wait(id: string) {
      const job = find(id);
      await job.done;
      return job;
    },
    stop(id: string) {
      cancel(find(id));
    },
    async reveal(id: string, projectId: string, location = 0) {
      const project = find(id).report.projects.find((project) => project.id === projectId);
      if (!project || !['folder', 'repository'].includes(project.kind))
        throw new HubError('Choose a verified folder from the current scan.');
      const directory = project.locations[location];
      if (
        !directory ||
        (await fs.realpath(directory)) !== directory ||
        !(await fs.stat(directory)).isDirectory()
      )
        throw new HubError('The folder changed or is unavailable. Scan again before revealing it.');
      await reveal(directory);
    },
    close() {
      for (const job of jobs.values()) cancel(job);
      jobs.clear();
      latest = undefined;
    },
  };
}
