import path from 'node:path';
import { discoverMemory } from '../core/memory-discovery.js';
import { planMemoryOnboarding } from '../core/memory-onboarding.js';
import { hubRoot } from '../core/paths.js';
import { printJson, table } from '../core/output.js';
import { runManaged, type ManagedOptions } from './content.js';
import { autoClient } from '../core/memory-auto-config.js';

interface Options extends ManagedOptions {
  workspace?: string;
  source?: string[];
  client?: string;
  follow?: boolean;
  at?: string;
}
export async function memoryDiscoverCommand(options: Options) {
  const report = await discoverMemory(hubRoot(), path.resolve(options.workspace ?? process.cwd()));
  if (options.client) autoClient(options.client);
  const sources = report.sources.filter(
    (source) => !options.client || source.client === options.client,
  );
  if (options.json) printJson({ ...report, sources });
  else {
    console.log(
      `Memory discovery for ${report.workspace}\nHub project: ${report.project ?? 'not registered'}`,
    );
    console.log(
      table(
        ['source ID', 'client', 'format', 'checkout', 'path', 'evidence'],
        sources.map((source) => [
          source.id,
          source.client,
          source.format,
          source.project ?? 'unresolved',
          source.path,
          source.evidence,
        ]),
      ),
    );
    for (const warning of report.warnings) console.log(`Notice: ${warning}`);
    console.log(
      'No files changed. Register the checkout if needed, then preview memory onboard. Only project-matched Markdown sources are selected by default.',
    );
  }
}
export function memoryOnboardCommand(options: Options) {
  const at = options.at ?? new Date().toISOString();
  return runManaged(
    () =>
      planMemoryOnboarding(hubRoot(), path.resolve(options.workspace ?? process.cwd()), at, {
        sources: options.source,
        client: options.client ? autoClient(options.client) : undefined,
        follow: options.follow,
      }),
    options,
  );
}
