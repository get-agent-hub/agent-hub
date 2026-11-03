import path from 'node:path';
import { memoryFile, memoryId, type MemoryLocation } from './memory-store.js';
import { memoryLocation } from './memory-projects.js';
import { type ArtifactRequest, type ManagedRow } from './managed-plan.js';
import { hash, isRecord } from './values.js';
import { HubError } from './errors.js';
import { CLIENT_IDS, type ClientId } from './types.js';

export interface MemoryAutomation {
  version: 1;
  enabled: boolean;
  clients: ClientId[];
  native: { client: ClientId; directory: string }[];
}
export const autoDirectory = (location: MemoryLocation) =>
  path.join(location.directory, 'automation');
export const autoPolicyPath = (location: MemoryLocation) =>
  path.join(autoDirectory(location), 'policy.json');
export const autoEntryPath = (location: MemoryLocation, key: string) =>
  path.join(autoDirectory(location), 'sources', hash(key) + '.json');
export const autoConflictPath = (location: MemoryLocation, key: string) =>
  path.join(autoDirectory(location), 'conflicts', hash(key) + '.json');
export const autoEventPath = (location: MemoryLocation, client: ClientId, session: string) =>
  path.join(autoDirectory(location), 'sessions', hash(`${client}:${session}`) + '.json');

export function autoClient(value: unknown): ClientId {
  if (!CLIENT_IDS.includes(value as ClientId))
    throw new HubError('Choose a known automation client.');
  return value as ClientId;
}

export async function readAutomation(root: string, workspace: string) {
  const location = await memoryLocation(root, { workspace });
  const file = await memoryFile(root, autoPolicyPath(location));
  let policy: MemoryAutomation = { version: 1, enabled: false, clients: [], native: [] };
  if (file.text !== null) {
    try {
      const value: unknown = JSON.parse(file.text);
      if (
        !isRecord(value) ||
        value.version !== 1 ||
        typeof value.enabled !== 'boolean' ||
        !Array.isArray(value.clients) ||
        !Array.isArray(value.native) ||
        value.native.length > 20
      )
        throw new Error();
      value.clients.forEach(autoClient);
      if (new Set(value.clients).size !== value.clients.length) throw new Error();
      for (const source of value.native) {
        if (
          !isRecord(source) ||
          typeof source.directory !== 'string' ||
          !path.isAbsolute(source.directory) ||
          !value.clients.includes(autoClient(source.client))
        )
          throw new Error();
      }
      policy = value as unknown as MemoryAutomation;
    } catch {
      throw new HubError('Invalid memory automation policy. Preserve it and resolve the metadata.');
    }
  }
  return { location, policy, file };
}

export function autoJson(
  before: Awaited<ReturnType<typeof memoryFile>>,
  value: unknown,
): ArtifactRequest | undefined {
  const content = JSON.stringify(value, null, 2) + '\n';
  if (Buffer.byteLength(content) > 128 * 1024)
    throw new HubError('Automation metadata exceeds its size budget.');
  return content === before.text
    ? undefined
    : { before: before.snapshot, client: 'memory', value: { kind: 'file', content, mode: 0o600 } };
}

export function autoRow(request: ArtifactRequest, name: string): ManagedRow {
  return {
    path: request.before.path,
    client: 'memory',
    name,
    action:
      request.value.kind === 'missing'
        ? 'remove'
        : request.before.kind === 'missing'
          ? 'add'
          : 'replace',
  };
}

export interface AutoFact {
  key: string;
  title: string;
  body: string;
  kind: 'fact' | 'preference' | 'decision' | 'lesson';
  evidence: string;
}

export function autoFact(value: unknown): AutoFact {
  if (
    !isRecord(value) ||
    Object.keys(value).some((key) => !['key', 'title', 'body', 'kind', 'evidence'].includes(key))
  )
    throw new HubError('Invalid automatic fact fields.');
  const key = memoryId(value.key);
  if (
    typeof value.title !== 'string' ||
    typeof value.body !== 'string' ||
    typeof value.evidence !== 'string' ||
    !value.evidence.trim() ||
    value.evidence.length > 1500 ||
    value.body.length > 16000 ||
    !['fact', 'preference', 'decision', 'lesson'].includes(value.kind as string)
  )
    throw new HubError('Automatic facts need a title, bounded body, kind and supporting evidence.');
  return {
    key,
    title: value.title,
    body: value.body,
    kind: value.kind as AutoFact['kind'],
    evidence: value.evidence,
  };
}

/** Conservative detection only; model instructions and source selection remain necessary. */
export function containsCredential(text: string) {
  return (
    /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----|\b(?:sk-[A-Za-z0-9_-]{20,}|AKIA[A-Z0-9]{16}|gh[pousr]_[A-Za-z0-9]{20,})\b/i.test(
      text,
    ) ||
    /\b(?:password|passwd|api[_-]?key|access[_-]?token|secret)\s*[:=]\s*["']?(?!\$\{|<|\[|example\b|redacted\b)[A-Za-z0-9_+/=.-]{12,}/i.test(
      text,
    )
  );
}
