import { randomBytes } from 'node:crypto';
import { applyManagedPlan, publicManagedPlan } from './managed-plan.js';
import {
  planMemoryMutation,
  getMemory,
  type MemoryMutation,
  type MemoryContext,
} from './memory.js';
import { memoryLocation } from './memory-projects.js';
import { queryMemory } from './memory-store.js';
import { HubError } from './errors.js';
import { isRecord } from './values.js';
import { autoStatus } from './memory-auto-status.js';
import { getAutomaticConflict, planAutomaticResolution } from './memory-auto-conflicts.js';
import type { ManagedPlan } from './managed-plan.js';
import { discoverMemory } from './memory-discovery.js';
import { planMemoryOnboarding } from './memory-onboarding.js';

export interface MemorySessionOptions {
  root: string;
  workspace: string;
  includeShared?: boolean;
  project?: boolean;
  writable?: boolean;
  sharedWritable?: boolean;
  automatic?: boolean;
}

/** Bound to one workspace; request fields can never grant access to another project. */
export function createMemorySession(options: MemorySessionOptions) {
  const previews = new Map<
    string,
    { build: () => Promise<ManagedPlan>; revision: string; expires: number }
  >();
  const context = (scope: unknown = 'project', writing = false): MemoryContext => {
    if (scope !== 'project' && scope !== 'shared')
      throw new HubError('Choose project or shared memory.');
    if (scope === 'project' && options.project === false)
      throw new HubError('Select a connected project before accessing project memory.');
    if (scope === 'shared' && !options.includeShared)
      throw new HubError('Shared memory is not enabled for this session.');
    if (writing && (!options.writable || (scope === 'shared' && !options.sharedWritable)))
      throw new HubError('Writes are not enabled for this memory scope.');
    return {
      root: options.root,
      selector: scope === 'shared' ? { shared: true } : { workspace: options.workspace },
    };
  };
  const remember = (plan: ManagedPlan, build: () => Promise<ManagedPlan>) => {
    for (const [id, entry] of previews) if (entry.expires < Date.now()) previews.delete(id);
    if (previews.size >= 50)
      throw new HubError('Too many memory previews; apply one or wait for expiry.');
    const id = randomBytes(16).toString('hex');
    previews.set(id, { build, revision: plan.revision, expires: Date.now() + 5 * 60_000 });
    const { commands: _commands, ...view } = publicManagedPlan(plan);
    return { id, ...view };
  };
  return {
    async discover() {
      context('project');
      return discoverMemory(options.root, options.workspace);
    },
    async previewOnboarding(sources: string[], follow: boolean) {
      context('project', true);
      const at = new Date().toISOString();
      const build = () =>
        planMemoryOnboarding(options.root, options.workspace, at, { sources, follow });
      return remember(await build(), build);
    },
    async automation() {
      context('project');
      return autoStatus(options.root, options.workspace);
    },
    async conflict(id: string) {
      context();
      const { snapshot: _snapshot, ...view } = await getAutomaticConflict(
        options.root,
        options.workspace,
        id,
      );
      return view;
    },
    async previewConflict(id: string, take: string) {
      context('project', true);
      const at = new Date().toISOString();
      const build = () => planAutomaticResolution(options.root, options.workspace, id, take, at);
      return remember(await build(), build);
    },
    async list(scope?: unknown, query = '', limit = 50) {
      const selected = context(scope);
      const result = await queryMemory(
        [await memoryLocation(selected.root, selected.selector)],
        query,
        limit,
      );
      return {
        ...result,
        results: result.results.map(({ snippet, ...record }) =>
          query ? { ...record, snippet } : record,
        ),
      };
    },
    async get(id: string, scope?: unknown) {
      return getMemory(context(scope), id);
    },
    async preview(value: unknown) {
      if (
        !isRecord(value) ||
        Object.keys(value).some(
          (key) =>
            ![
              'operation',
              'id',
              'scope',
              'title',
              'body',
              'kind',
              'tags',
              'source',
              'recordRevision',
            ].includes(key),
        )
      )
        throw new HubError('Invalid memory mutation fields.');
      if (
        !['create', 'update', 'delete'].includes(value.operation as string) ||
        typeof value.id !== 'string'
      )
        throw new HubError('Choose an operation and a record ID.');
      for (const key of ['title', 'body', 'kind', 'recordRevision'])
        if (value[key] !== undefined && typeof value[key] !== 'string')
          throw new HubError(`Invalid memory ${key}.`);
      if (value.source !== undefined && value.source !== null && typeof value.source !== 'string')
        throw new HubError('Invalid memory source.');
      if (value.tags !== undefined && !Array.isArray(value.tags))
        throw new HubError('Memory tags must be an array.');
      const selected = context(value.scope, true);
      const { scope: _scope, ...fields } = value;
      const input = { ...fields, at: new Date().toISOString() } as unknown as MemoryMutation;
      const build = () => planMemoryMutation(selected, input);
      return remember(await build(), build);
    },
    async apply(id: string, revision: string) {
      const preview = previews.get(id);
      previews.delete(id);
      if (!preview || preview.expires < Date.now() || revision !== preview.revision)
        throw new HubError('Memory preview expired, was used, or has a different revision.');
      const build = preview.build;
      const plan = await build();
      if (plan.revision !== revision)
        throw new HubError('Inputs changed since preview. Review a new dry run.');
      return applyManagedPlan(plan, build, revision);
    },
  };
}

export type MemorySession = ReturnType<typeof createMemorySession>;
