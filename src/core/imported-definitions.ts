import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { stableStringify } from './mcp.js';
import type { HubServer } from './registry.js';
import type { ClientId } from './types.js';

export interface ImportedDefinition { desired: string; clients: Partial<Record<ClientId, string>> }
export interface ImportedDefinitions { version: 1; servers: Record<string, ImportedDefinition> }
export const definitionSignature = (value: unknown) => createHash('sha256').update(stableStringify(value)).digest('hex');

export function desiredSignature(server: HubServer, vars: Map<string, string>) {
  const { clients: _c, tags: _t, only: _o, proxy: _p, ...core } = server;
  const resolve = (value: unknown): unknown => {
    if (typeof value === 'string') return value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, key) => vars.get(key) ?? process.env[key] ?? `\${${key}}`);
    if (Array.isArray(value)) return value.map(resolve);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolve(item)]));
    return value;
  };
  return definitionSignature(resolve({ ...core, transport: core.transport ?? (core.command ? 'stdio' : 'http') }));
}

export async function readImportedDefinitions(root: string): Promise<ImportedDefinitions> {
  try {
    const doc = JSON.parse(await fs.readFile(path.join(root, 'state', 'imported-definitions.json'), 'utf8'));
    if (doc.version !== 1 || !doc.servers || typeof doc.servers !== 'object' || Array.isArray(doc.servers)) throw new Error();
    for (const entry of Object.values(doc.servers) as ImportedDefinition[]) {
      if (!entry || !/^[a-f0-9]{64}$/.test(entry.desired) || !entry.clients || typeof entry.clients !== 'object' || Object.values(entry.clients).some((hash) => typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash))) throw new Error();
    }
    return doc;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, servers: {} };
    throw new Error('Cannot read imported definition fingerprints.');
  }
}

export async function writeImportedDefinitions(root: string, doc: ImportedDefinitions) {
  const dir = path.join(root, 'state');
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const tmp = path.join(dir, `imported-definitions-${randomBytes(8).toString('hex')}.tmp`);
  try {
    await fs.writeFile(tmp, JSON.stringify(doc, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    await fs.rename(tmp, path.join(dir, 'imported-definitions.json'));
  } finally { await fs.unlink(tmp).catch(() => undefined); }
}
