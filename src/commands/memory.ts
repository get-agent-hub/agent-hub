import fs from 'node:fs/promises';
import path from 'node:path';
import { TextDecoder } from 'node:util';
import {
  getMemory,
  planMemoryMutation,
  type MemoryContext,
  type MemoryMutation,
} from '../core/memory/records.js';
import { MEMORY_LIMIT, queryMemory, type MemoryRecord } from '../core/memory/store.js';
import {
  memoryLocation,
  memoryRegistry,
  planMemoryProject,
} from '../core/projects/memory-bindings.js';
import { inspectArtifact, sameArtifact } from '../shared/artifacts.js';
import { HubError } from '../shared/errors.js';
import { printJson, table } from '../shared/output.js';
import { hubRoot } from '../shared/paths.js';
import { runManaged, type ManagedOptions } from './content.js';

export interface MemoryOptions extends ManagedOptions {
  shared?: boolean;
  workspace?: string;
  title?: string;
  file?: string;
  kind?: MemoryRecord['kind'];
  tag?: string[];
  clearTags?: boolean;
  source?: string;
  clearSource?: boolean;
  at?: string;
  recordRevision?: string;
  limit?: string;
}

function context(options: MemoryOptions): MemoryContext {
  if (options.shared && options.workspace)
    throw new HubError('Choose --shared or --workspace, not both.');
  return {
    root: hubRoot(),
    selector: options.shared
      ? { shared: true }
      : { workspace: path.resolve(options.workspace ?? process.cwd()) },
  };
}

export async function memoryListCommand(query: string, options: MemoryOptions) {
  const selected = context(options);
  const result = await queryMemory(
    [await memoryLocation(selected.root, selected.selector)],
    query,
    Number(options.limit ?? 50),
  );
  if (options.json) printJson(result);
  else {
    console.log(
      table(
        ['id', 'title', 'scope', 'kind'],
        result.results.map((record) => [record.id, record.title, record.scope, record.kind]),
      ),
    );
    console.log(`${result.results.length} of ${result.total} matching record(s).`);
  }
}

export async function memoryGetCommand(id: string, options: MemoryOptions) {
  const record = await getMemory(context(options), id);
  if (options.json) printJson(record);
  else
    console.log(
      `${record.title}\nScope: ${record.scope}\nRevision: ${record.revision}\n\n${record.body}`,
    );
}

export async function memoryWriteCommand(
  operation: MemoryMutation['operation'],
  id: string,
  options: MemoryOptions,
  imported = false,
) {
  const selected = context(options);
  if (options.clearTags && options.tag) throw new HubError('Choose --tag or --clear-tags.');
  if (options.clearSource && options.source !== undefined)
    throw new HubError('Choose --source or --clear-source.');
  if (imported && !options.file)
    throw new HubError('Import requires a local --file containing the selected knowledge.');
  const at = options.at ?? new Date().toISOString();
  const file = options.file ? path.resolve(options.file) : undefined;
  const command = [
    'memory',
    imported ? 'import' : operation === 'create' ? 'add' : operation === 'update' ? 'update' : 'rm',
    id,
  ];
  command.push(
    ...('shared' in selected.selector
      ? ['--shared']
      : ['--workspace', selected.selector.workspace]),
  );
  command.push('--at', at);
  for (const [flag, value] of [
    ['--title', options.title],
    ['--file', file],
    ['--kind', options.kind],
    ['--source', options.source],
    ['--record-revision', options.recordRevision],
  ] as const)
    if (value !== undefined) command.push(flag, value);
  for (const tag of options.tag ?? []) command.push('--tag', tag);
  if (options.clearTags) command.push('--clear-tags');
  if (options.clearSource) command.push('--clear-source');
  await runManaged(async () => {
    let body: string | undefined;
    const sources = [];
    if (file) {
      const before = await inspectArtifact(file);
      if (before.kind !== 'file' || (await fs.stat(file)).size > MEMORY_LIMIT)
        throw new HubError(
          'Memory input must be a regular local UTF-8 file within the size limit.',
        );
      const bytes = await fs.readFile(file);
      if (bytes.length > MEMORY_LIMIT) throw new HubError('Memory input exceeds the size limit.');
      try {
        body = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      } catch {
        throw new HubError('Memory input must be valid UTF-8.');
      }
      if (!sameArtifact(before, await inspectArtifact(file)))
        throw new HubError('Memory input changed while reading.');
      sources.push(before);
    }
    return planMemoryMutation(
      selected,
      {
        operation,
        id,
        at,
        title: options.title,
        body,
        kind: options.kind,
        tags: options.clearTags ? [] : options.tag,
        source: options.clearSource ? null : (options.source ?? (imported ? file : undefined)),
        recordRevision: options.recordRevision,
      },
      command,
      sources,
    );
  }, options);
}

export const memoryProjectCommand = (
  id: string,
  directory: string | undefined,
  options: ManagedOptions & { rebind?: boolean },
) =>
  runManaged(
    () => planMemoryProject(hubRoot(), id, directory ?? process.cwd(), options.rebind),
    options,
  );

export async function memoryProjectsCommand(options: { json?: boolean }) {
  const { registry } = await memoryRegistry(hubRoot());
  if (options.json) printJson(registry);
  else
    console.log(
      table(
        ['project', 'checkout'],
        registry.projects.flatMap((project) =>
          project.checkouts.map((checkout) => [project.id, checkout.path]),
        ),
      ),
    );
}
