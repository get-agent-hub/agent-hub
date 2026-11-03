import fs from 'node:fs/promises';
import path from 'node:path';
import { autoDirectory, autoClient, readAutomation } from './memory-auto-config.js';
import { memoryFile, memoryPath, memoryId, decodeMemory } from './memory-store.js';
import { planAutomaticFacts } from './memory-auto-sync.js';
import { sameArtifact, inspectArtifact } from './artifacts.js';
import { hash, isRecord } from './values.js';
import { HubError } from './errors.js';
import type { NativeFact } from './memory-auto-native.js';

export async function getAutomaticConflict(
  root: string,
  workspace: string,
  id: string,
  version?: string,
) {
  if (!/^auto-[a-f0-9]{24}$/.test(id) || (version !== undefined && !/^[a-f0-9]{64}$/.test(version)))
    throw new HubError('Choose a valid automatic conflict ID and version.');
  const { location } = await readAutomation(root, workspace);
  const directory = path.join(autoDirectory(location), 'conflicts');
  await memoryPath(root, directory, true);
  let names: string[];
  try {
    names = await fs.readdir(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    names = [];
  }
  let matches = names.filter(
    (name) => /^[a-f0-9]{64}\.json$/.test(name) && name.startsWith(id.slice(5)),
  );
  const historyRoot = path.join(autoDirectory(location), 'conflict-history');
  if (!matches.length && version) {
    await memoryPath(root, historyRoot, true);
    let archives: string[] = [];
    try {
      archives = await fs.readdir(historyRoot);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    if (archives.length > 5000) throw new HubError('Conflict history exceeds its listing budget.');
    matches = archives
      .filter((name) => /^[a-f0-9]{64}$/.test(name) && name.startsWith(id.slice(5)))
      .map((name) => name + '.json');
  }
  if (matches.length !== 1)
    throw new HubError('Conflict not found or its ID is ambiguous in this project.');
  const file = await memoryFile(root, path.join(directory, matches[0]!));
  let value: unknown;
  const historical = file.text === null && version;
  const selected = historical
    ? await memoryFile(root, path.join(historyRoot, matches[0]!.slice(0, -5), version + '.json'))
    : file;
  try {
    value = JSON.parse(selected.text ?? 'null');
  } catch {
    throw new HubError('Invalid conflict metadata.');
  }
  if (historical && isRecord(value) && isRecord(value.fact))
    value = {
      ...value,
      key: value.fact.key,
      source: value.fact.source,
      reason: 'Archived incoming version; this conflict is no longer pending.',
    };
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    value.id !== id ||
    typeof value.key !== 'string' ||
    hash(value.key) + '.json' !== matches[0] ||
    !isRecord(value.fact)
  )
    throw new HubError('Invalid conflict identity.');
  let incoming = value.fact;
  const historyDirectory = path.join(autoDirectory(location), 'conflict-history', hash(value.key));
  await memoryPath(root, historyDirectory, true);
  let history: string[];
  try {
    history = (await fs.readdir(historyDirectory))
      .filter((name) => /^[a-f0-9]{64}\.json$/.test(name))
      .sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    history = [];
  }
  if (history.length > 2000) throw new HubError('Conflict history exceeds its listing budget.');
  if (version) {
    const archived = await memoryFile(root, path.join(historyDirectory, version + '.json'));
    let record: unknown;
    try {
      record = JSON.parse(archived.text ?? 'null');
    } catch {
      throw new HubError('Invalid conflict history.');
    }
    if (!isRecord(record) || record.id !== id || !isRecord(record.fact))
      throw new HubError('Conflict history version not found.');
    incoming = record.fact;
  }
  if (
    incoming.key !== value.key ||
    typeof incoming.title !== 'string' ||
    typeof incoming.body !== 'string' ||
    typeof incoming.evidence !== 'string' ||
    typeof incoming.source !== 'string' ||
    !['fact', 'preference', 'decision', 'lesson'].includes(incoming.kind as string)
  )
    throw new HubError('Invalid incoming conflict fact.');
  autoClient(incoming.client);
  const target = memoryId(value.target ?? id);
  const current = await memoryFile(root, path.join(location.records, target + '.md'));
  return {
    id,
    target,
    source: value.source,
    reason: value.reason,
    incoming: incoming as unknown as NativeFact,
    current: current.text === null ? null : decodeMemory(current.text, target, location.scope),
    versions: history.map((name) => name.slice(0, -5)),
    snapshot: file.snapshot,
  };
}

export async function planAutomaticResolution(
  root: string,
  workspace: string,
  id: string,
  take: string,
  at: string,
) {
  if (!['incoming', 'hub'].includes(take))
    throw new HubError('Choose incoming or hub when resolving a conflict.');
  const conflict = await getAutomaticConflict(root, workspace, id);
  const plan = await planAutomaticFacts(root, workspace, [conflict.incoming], at, {
    manual: true,
    resolve: take === 'incoming' ? [id] : [],
    keep: take === 'hub' ? [id] : [],
    command: [
      'memory',
      'auto',
      'conflict',
      'resolve',
      id,
      '--workspace',
      workspace,
      '--take',
      take,
      '--at',
      at,
    ],
  });
  if (!sameArtifact(conflict.snapshot, await inspectArtifact(conflict.snapshot.path)))
    throw new HubError('Conflict changed during planning. Review again.');
  return plan;
}
