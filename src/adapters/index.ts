import type { ClientAdapter } from '../core/types.js';
import { claudeAdapter } from './claude.js';
import { codexAdapter } from './codex.js';
import { dshAdapter } from './dsh.js';

export const adapters: ClientAdapter[] = [claudeAdapter, codexAdapter, dshAdapter];
