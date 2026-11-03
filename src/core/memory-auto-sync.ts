import path from 'node:path';
import {
  type ArtifactRequest,
  type ManagedRow,
  managedPlan,
  applyManagedPlan,
} from './managed-plan.js';
import { type ArtifactSnapshot } from './artifacts.js';
import { encodeMemory, memoryFile, readMemoryCollection } from './memory-store.js';
import { planMemoryBatch, projectMemoryRecord, type MemoryMutation } from './memory.js';
import {
  knowledgeHash,
  sourceInputHash,
  readSourceBinding,
  type SourceBinding,
} from './memory-auto-bindings.js';
import {
  autoEntryPath,
  autoConflictPath,
  autoJson,
  autoRow,
  containsCredential,
  readAutomation,
} from './memory-auto-config.js';
import { scanNativeMemory, type NativeFact } from './memory-auto-native.js';
import { hash } from './values.js';
import { HubError } from './errors.js';
import { retryAutomatic } from './memory-auto-retry.js';

export async function planAutomaticFacts(
  root: string,
  workspace: string,
  incoming: NativeFact[],
  at: string,
  options: {
    sources?: ArtifactSnapshot[];
    requests?: ArtifactRequest[];
    rows?: ManagedRow[];
    command?: string[];
    resolve?: string[];
    allowUpdates?: boolean;
    keep?: string[];
    manual?: boolean;
  } = {},
) {
  const { policy, location, file: policyFile } = await readAutomation(root, workspace);
  if (!policy.enabled && !options.manual)
    throw new HubError('Memory automation is disabled for this project.');
  const entries = await readMemoryCollection(location);
  const existing = new Map(entries.map((entry) => [entry.record.id, entry.record]));
  const mutations: MemoryMutation[] = [];
  const requests: ArtifactRequest[] = [...(options.requests ?? [])];
  const rows: ManagedRow[] = [...(options.rows ?? [])];
  const sources = [...(options.sources ?? []), policyFile.snapshot];
  const bindings: { file: Awaited<ReturnType<typeof memoryFile>>; value: SourceBinding }[] = [];
  const seen = new Set<string>();
  for (const fact of [...incoming].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))) {
    if (!policy.clients.includes(fact.client) && !options.manual)
      throw new HubError('Source client is not enabled in this project automation policy.');
    if (seen.has(fact.key))
      throw new HubError('An automatic batch contains duplicate source keys.');
    seen.add(fact.key);
    const id = `auto-${hash(fact.key).slice(0, 24)}`;
    const pointer = await memoryFile(root, autoEntryPath(location, fact.key));
    const binding = readSourceBinding(pointer, fact.key, id);
    const inputHash = sourceInputHash(fact);
    const recordId = binding?.record ?? id;
    const record = existing.get(recordId);
    const conflict = await memoryFile(root, autoConflictPath(location, fact.key));
    const resolving = options.resolve?.includes(id) === true;
    const row: ManagedRow = {
      path: path.join(location.records, recordId + '.md'),
      client: 'memory',
      name: id,
      action: 'keep',
    };
    rows.push(row);
    if (containsCredential(`${fact.title}\n${fact.body}\n${fact.evidence}`)) {
      row.action = 'skip';
      row.note = 'Possible credential detected; content was not retained.';
      sources.push(pointer.snapshot, conflict.snapshot);
      continue;
    }
    const sameKnowledge = record && knowledgeHash(record) === knowledgeHash(fact);
    const acknowledged =
      binding && binding.revision === (record?.revision ?? null) && binding.inputHash === inputHash;
    const keeping = options.keep?.includes(id) === true;
    if (keeping) {
      bindings.push({
        file: pointer,
        value: {
          version: 2,
          key: fact.key,
          record: recordId,
          owned: false,
          revision: record?.revision ?? null,
          inputHash,
        },
      });
      row.note = 'Reviewed: retain the Hub value or deletion; acknowledge this source version.';
    } else if (acknowledged) {
      sources.push(pointer.snapshot);
    } else if (binding && !binding.owned && sameKnowledge) {
      bindings.push({
        file: pointer,
        value: { ...binding, revision: record!.revision, inputHash },
      });
      row.note = 'Equivalent source remains linked to the canonical fact without taking ownership.';
    } else if (
      ((record &&
        (!binding ||
          !binding.owned ||
          record.revision !== binding.revision ||
          options.allowUpdates === false)) ||
        (binding && !record)) &&
      !resolving
    ) {
      row.action = 'preserve';
      row.note =
        'Conflict: source diverged, Hub changed or was removed, or the conversation has an older memory revision. Review both values before resolving.';
      const value = {
        version: 1,
        id,
        target: recordId,
        key: fact.key,
        source: fact.source,
        reason: row.note,
        recordRevision: record?.revision ?? null,
        fact,
      };
      const request = autoJson(conflict, value);
      if (request) requests.push(request);
      else sources.push(conflict.snapshot);
      const history = await memoryFile(
        root,
        path.join(
          path.dirname(path.dirname(conflict.snapshot.path)),
          'conflict-history',
          hash(fact.key),
          hash(JSON.stringify(fact)) + '.json',
        ),
      );
      const archived = autoJson(history, { version: 1, id, target: recordId, fact });
      if (archived && history.text === null) requests.push(archived);
      else sources.push(history.snapshot);
      sources.push(pointer.snapshot);
      continue;
    } else if (
      !binding &&
      !record &&
      [...existing.values()].some((candidate) => knowledgeHash(candidate) === knowledgeHash(fact))
    ) {
      const canonical = [...existing.values()].find(
        (candidate) => knowledgeHash(candidate) === knowledgeHash(fact),
      )!;
      bindings.push({
        file: pointer,
        value: {
          version: 2,
          key: fact.key,
          record: canonical.id,
          owned: false,
          revision: canonical.revision,
          inputHash,
        },
      });
      row.note = `Equivalent knowledge is linked to ${canonical.id}; both source identities are retained.`;
    } else {
      row.action = record ? 'replace' : 'add';
      row.note = fact.source;
      const mutation: MemoryMutation = {
        operation: record ? 'update' : 'create',
        id: recordId,
        title: fact.title,
        body: fact.body,
        kind: fact.kind,
        tags: [fact.key.startsWith('native:') ? 'native-memory' : 'auto-extracted'],
        source: `${fact.source} | ${fact.evidence.replace(/\s+/g, ' ').trim()}`.slice(0, 2048),
        at,
        recordRevision: record?.revision,
      };
      mutations.push(mutation);
      const projected = projectMemoryRecord(location.scope, mutation, record);
      const revision = hash(encodeMemory(projected));
      existing.set(recordId, { ...projected, revision });
      bindings.push({
        file: pointer,
        value: {
          version: 2,
          key: fact.key,
          record: recordId,
          owned: binding?.owned ?? true,
          revision,
          inputHash,
        },
      });
    }
    if (conflict.text !== null)
      requests.push({ before: conflict.snapshot, client: 'memory', value: { kind: 'missing' } });
    else sources.push(conflict.snapshot);
  }
  const base = await planMemoryBatch(
    { root, selector: { workspace } },
    mutations,
    options.command ?? ['memory', 'auto', 'sync', '--workspace', workspace, '--at', at],
    sources,
  );
  const bindingSources: ArtifactSnapshot[] = [];
  for (const binding of bindings) {
    const request = autoJson(binding.file, binding.value);
    if (request) requests.push(request);
    else bindingSources.push(binding.file.snapshot);
  }
  return managedPlan(
    {
      root,
      command: base.command,
      requests: [...base.requests, ...requests],
      rows: [
        ...rows,
        ...base.rows.filter((row) => !rows.some((other) => other.path === row.path)),
        ...requests.map((request) => autoRow(request, 'automation metadata')),
      ],
      sources: [...base.sources, ...bindingSources],
    },
    { base: base.revision, incoming },
  );
}

export async function planNativeSync(
  root: string,
  workspace: string,
  at: string,
  resolve: string[] = [],
) {
  const { policy } = await readAutomation(root, workspace);
  if (!policy.enabled) throw new HubError('Memory automation is disabled for this project.');
  const scans = await Promise.all(policy.native.map((source) => scanNativeMemory(root, source)));
  return planAutomaticFacts(
    root,
    workspace,
    scans.flatMap((scan) => scan.facts),
    at,
    {
      sources: scans.flatMap((scan) => scan.sources),
      resolve,
      command: [
        'memory',
        'auto',
        'sync',
        '--workspace',
        workspace,
        '--at',
        at,
        ...resolve.flatMap((id) => ['--resolve', id]),
      ],
      rows: scans.flatMap((scan) =>
        scan.skipped.map((item) => ({
          path: item.path,
          client: 'memory',
          name: path.basename(item.path),
          action: 'skip' as const,
          note: item.reason,
        })),
      ),
    },
  );
}

export async function syncNativeAutomatically(root: string, workspace: string) {
  return retryAutomatic(async () => {
    const at = new Date().toISOString();
    const build = () => planNativeSync(root, workspace, at);
    const plan = await build();
    const result = await applyManagedPlan(plan, build, plan.revision);
    return {
      ...result,
      conflicts: plan.rows.filter((row) => row.action === 'preserve').length,
      skipped: plan.rows.filter((row) => row.action === 'skip').length,
    };
  });
}
