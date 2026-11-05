import { type ClientId } from '../../../contracts/clients.js';
export interface QuickOptions {
  clients?: ClientId[];
  prefer?: ClientId;
  at?: string;
}
export interface ProjectConnectOptions {
  workspace?: string;
  clients?: ClientId[];
  automation?: boolean;
  at?: string;
}
export interface SetupOptions extends QuickOptions, ProjectConnectOptions {
  scope: 'hub' | 'project';
}
export type ReviewRow = { name: string; action: string; note?: string; client?: string };
export interface QuickStep {
  id: string;
  title: string;
  status: 'planned' | 'deferred' | 'done' | 'unchanged' | 'review' | 'failed' | 'skipped';
  rows?: ReviewRow[];
  note?: string;
  backup?: string | null;
  restoreCommand?: string | null;
  changed?: number;
}
