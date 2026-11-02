import type { ClientAdapter, ClientId } from '../core/types.js';
import { claudeAdapter } from './claude.js';
import { codexAdapter } from './codex.js';
import { dshAdapter } from './dsh.js';

export const adapters: ClientAdapter[] = [claudeAdapter, codexAdapter, dshAdapter];

export function getAdapter(id: string): ClientAdapter {
  const a = adapters.find((x) => x.id === (id as ClientId));
  if (!a) throw new Error(`Unknown client "${id}". Known: ${adapters.map((x) => x.id).join(', ')}`);
  return a;
}
