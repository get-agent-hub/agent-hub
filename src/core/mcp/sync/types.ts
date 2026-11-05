import type { ClientId } from '../../../contracts/clients.js';
import { type FileSnapshot } from '../../../shared/file-store.js';
import { type Definition } from '../config-edit.js';
export interface SyncOptions {
  client?: ClientId;
  /** Exact existing records explicitly selected for a reviewed replacement. */
  replace?: string[];
  only?: string[];
}

export interface SyncTarget {
  id: ClientId;
  label: string;
  file: string;
  installed: boolean;
}

export interface SyncContext {
  root: string;
  targets: SyncTarget[];
  node: string;
  cli: string;
}

export interface Ownership {
  version: 1;
  clients: Partial<Record<ClientId, { file: string; entries: Record<string, string> }>>;
}

export interface SyncRow {
  name: string;
  action: 'add' | 'replace' | 'keep' | 'remove' | 'preserve' | 'skip' | 'conflict';
  note?: string;
  command?: string;
  config?: Definition;
}

export interface TargetPlan {
  target: SyncTarget;
  snapshot: FileSnapshot;
  next: string;
  rows: SyncRow[];
  owned: Record<string, string>;
  problem?: string;
}

/** Contains original client files, potentially credentials. Never serialize this object. */
export interface SyncPlan {
  context: SyncContext;
  options: SyncOptions;
  revision: string;
  sourceRevision: string;
  targets: TargetPlan[];
  state: Ownership;
  stateBefore: string | null;
  blocked: boolean;
}

export interface BackupManifest {
  version: 1;
  files: {
    client: ClientId;
    file: string;
    realFile: string;
    mode: number;
    backup: string | null;
    beforeHash: string;
    afterHash: string;
  }[];
  stateAfterHash: string;
}
