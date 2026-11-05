import type { HistoryCatalog, HistoryProject } from '../../contracts/history.js';
import { hash } from '../../shared/values.js';
import { verifiedProjectLocation } from '../projects/discovery.js';
import fs from 'node:fs/promises';

export type HistoryLocationCache = Map<
  string,
  Awaited<ReturnType<typeof verifiedProjectLocation>> & { binding: string }
>;

/** Durable associations are separate from the memory registry and never authorize writes. */
export async function associateHistoryProjects(
  catalog: HistoryCatalog,
  locations: Set<string>,
  signal?: AbortSignal,
  cache: HistoryLocationCache = new Map(),
) {
  const result: string[] = [];
  for (const cwd of locations) {
    let location = cache.get(cwd);
    if (!location) {
      const verified = await verifiedProjectLocation(cwd, signal);
      let binding = 'unavailable';
      try {
        const identity = await fs.stat(
          verified.key.startsWith('git:') ? verified.key.slice(4) : verified.directory,
        );
        binding = `${identity.dev}:${identity.ino}`;
      } catch {
        /* Missing historical folders remain explicit candidates. */
      }
      location = { ...verified, binding };
      cache.set(cwd, location);
    }
    const verified = location;
    let project =
      catalog.projects.find((item) => item.aliases.includes(cwd)) ??
      catalog.projects.find(
        (item) => item.key === verified.key && item.binding === verified.binding,
      );
    if (!project) {
      project = {
        id: hash(`${location.key}\0${location.binding}`),
        key: location.key,
        label: location.label,
        kind: location.kind,
        locations: [],
        aliases: [],
        binding: location.binding,
      } satisfies HistoryProject;
      catalog.projects.push(project);
    }
    project.locations = [...new Set([...project.locations, cwd, location.directory])];
    if (!result.includes(project.id)) result.push(project.id);
  }
  return result;
}
