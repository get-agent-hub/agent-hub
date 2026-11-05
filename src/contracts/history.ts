import type { ClientId } from './clients.js';

export interface HistorySource {
  id: string;
  client: ClientId;
  root: string;
  label: string;
  layout: 'claude' | 'codex' | 'dsh';
  binding?: string;
}
export interface HistoryFile {
  source: HistorySource;
  file: string;
  relative: string;
}
export interface HistoryEvent {
  ordinal: number;
  nativeId: string | null;
  parentId: string | null;
  type: string;
  role: string;
  timestamp: string | null;
  text: string;
  raw: unknown;
}
export interface HistoryAsset {
  id: string;
  reference: string;
  status: 'preserved' | 'missing' | 'outside-source' | 'remote' | 'embedded';
  digest?: string;
  bytes?: number;
}
export interface HistoryChat {
  id: string;
  sourceId: string;
  client: ClientId;
  nativeId: string;
  relative: string;
  title: string;
  parentNativeId: string | null;
  kind: 'chat' | 'subagent';
  locations: string[];
  projects: string[];
  revision: string;
  revisions: string[];
  events: number;
  bytes: number;
  indexedBytes: number;
  content: 'complete' | 'pending-tail' | 'partial' | 'unsupported';
  assets: HistoryAsset[];
  issues: string[];
  observedAt: string;
  sourceStamp?: string;
}
export interface HistoryProject {
  id: string;
  key: string;
  label: string;
  kind: 'repository' | 'folder' | 'missing' | 'unverified';
  locations: string[];
  aliases: string[];
  binding?: string;
}
export interface HistoryReceipt {
  source: HistorySource;
  coverage: 'complete' | 'partial' | 'not-found' | 'unavailable';
  checked: number;
  changed: number;
  bytes: number;
  issues: string[];
  checkedAt: string;
}
export interface HistoryCatalog {
  version: 1;
  sources: HistorySource[];
  receipts: HistoryReceipt[];
  chats: HistoryChat[];
  projects: HistoryProject[];
  excluded: string[];
  deleted: string[];
  tombstones: {
    id: string;
    sourceId: string;
    relative: string;
    nativeId: string;
    sourceStamp?: string;
  }[];
  grants: { id: string; projects: string[]; sources: string[] }[];
}
export interface HistoryControl {
  signal?: AbortSignal;
  onProgress?: (receipt: HistoryReceipt) => void;
}
