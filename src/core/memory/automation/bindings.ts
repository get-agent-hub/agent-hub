import { HubError } from '../../../shared/errors.js';
import { hash, isRecord, stableStringify } from '../../../shared/values.js';
import { memoryFile, memoryId, type MemoryRecord } from '../store.js';

export interface SourceBinding {
  version: 2;
  key: string;
  record: string;
  owned: boolean;
  revision: string | null;
  inputHash: string;
}

export function knowledgeBody(body: string) {
  return body
    .replace(/\r\n/g, '\n')
    .replace(/^(?:[ \t]*\n)+/, '')
    .replace(/(?:\n[ \t]*)+$/, '');
}
export const knowledgeHash = (record: Pick<MemoryRecord, 'body' | 'kind'>) =>
  hash(stableStringify({ body: knowledgeBody(record.body), kind: record.kind }));
export const sourceInputHash = (record: Pick<MemoryRecord, 'body' | 'kind' | 'title'>) =>
  hash(
    stableStringify({ title: record.title, body: knowledgeBody(record.body), kind: record.kind }),
  );

export function readSourceBinding(
  file: Awaited<ReturnType<typeof memoryFile>>,
  key: string,
  ownId: string,
): SourceBinding | undefined {
  if (file.text === null) return undefined;
  try {
    const value: unknown = JSON.parse(file.text);
    if (
      !isRecord(value) ||
      ![1, 2].includes(value.version as number) ||
      value.key !== key ||
      typeof value.record !== 'string' ||
      typeof value.inputHash !== 'string' ||
      !/^[a-f0-9]{64}$/.test(value.inputHash) ||
      (value.revision !== null &&
        (typeof value.revision !== 'string' || !/^[a-f0-9]{64}$/.test(value.revision)))
    )
      throw new Error();
    const owned = value.version === 1 ? true : value.owned;
    if (
      typeof owned !== 'boolean' ||
      (owned && (value.record !== ownId || value.revision === null))
    )
      throw new Error();
    memoryId(value.record);
    return {
      version: 2,
      key,
      record: value.record,
      owned,
      revision: value.revision as string | null,
      inputHash: value.inputHash,
    };
  } catch {
    throw new HubError('Invalid automatic memory source binding.');
  }
}
