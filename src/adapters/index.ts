import type { ClientAdapter } from '../contracts/clients.js';
import { claudeAdapter } from './claude.js';
import { codexAdapter } from './codex.js';
import { dshAdapter } from './dsh.js';

export const adapters: ClientAdapter[] = [claudeAdapter, codexAdapter, dshAdapter];
