import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { adapters } from '../adapters/index.js';
import { collectStatus } from '../commands/status.js';
import { readHub } from '../core/hub.js';
import { extractSecrets } from '../core/importer.js';
import { hubRoot, tildify } from '../core/paths.js';
import { inferTransport, readRegistry, type HubServer } from '../core/registry.js';
import { isInlineSecret } from '../core/secrets.js';
import { cachedDoctor } from '../core/doctor.js';
import type { ClientAdapter } from '../core/types.js';

const exec = promisify(execFile);
const MAX_DOCUMENT = 256 * 1024;

/** Resolve only known document paths; a symlink must stay inside its allowed root. */
export async function documentAt(root: string, relative: string) {
  const file = path.join(root, relative);
  try {
    const [realRoot, realFile] = await Promise.all([fs.realpath(root), fs.realpath(file)]);
    const rel = path.relative(realRoot, realFile);
    if (rel.startsWith('..') || path.isAbsolute(rel)) return { path: tildify(file), content: null, reason: 'File points outside this directory.' };
    const stat = await fs.stat(realFile);
    if (!stat.isFile() || stat.size > MAX_DOCUMENT) return { path: tildify(file), content: null, reason: 'Document is too large to preview.' };
    return { path: tildify(file), content: await fs.readFile(realFile, 'utf8'), modifiedAt: stat.mtime.toISOString() };
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    return { path: tildify(file), content: null, reason: 'Not created yet.' };
  }
}

const reference = (value: string) => /^(?:(?:Bearer|Basic|Token) )?\$\{[A-Za-z_][A-Za-z0-9_]*\}$/.test(value);

function safeValue(value: string): string {
  if (reference(value)) return value;
  if (/^https?:\/\//.test(value)) {
    try {
      const url = new URL(value);
      url.username = ''; url.password = '';
      for (const [key, val] of url.searchParams) if (!reference(val)) url.searchParams.set(key, '[hidden]');
      return decodeURI(url.toString());
    } catch { return '[hidden]'; }
  }
  return isInlineSecret('', value) ? '[hidden]' : value;
}

/** Display references, never credentials. Do not serialize raw client MCP definitions. */
export function displayServer(name: string, input: HubServer) {
  const s = extractSecrets(name, input, new Map()).server;
  return {
    transport: inferTransport(s),
    command: s.command ? safeValue(s.command) : undefined,
    args: s.args?.map(safeValue),
    cwd: s.cwd ? tildify(s.cwd) : undefined,
    url: s.url ? safeValue(s.url) : undefined,
    env: s.env && Object.fromEntries(Object.entries(s.env).map(([k, v]) => [k, reference(v) ? v : '[hidden]'])),
    headers: s.headers && Object.fromEntries(Object.entries(s.headers).map(([k, v]) => [k, reference(v) ? v : '[hidden]'])),
    proxy: s.proxy,
    only: s.only,
    tags: s.tags,
  };
}

async function memoryDocuments() {
  const root = path.join(hubRoot(), 'memory');
  let names: string[];
  try { names = await fs.readdir(root); }
  catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return []; throw e; }
  return Promise.all(names.filter((n) => n.endsWith('.md')).sort().map(async (name) => ({ name, ...await documentAt(root, name) })));
}

async function workspace(cwd: string) {
  let root: string;
  try { root = (await exec('git', ['rev-parse', '--show-toplevel'], { cwd, timeout: 3000 })).stdout.trim(); }
  catch { return null; }
  let branch = 'detached';
  try { branch = (await exec('git', ['branch', '--show-current'], { cwd: root, timeout: 3000 })).stdout.trim() || 'detached'; } catch { /* empty repo */ }
  const files = await Promise.all(['AGENTS.md', '.agents/state/PROJECT.md', '.agents/state/NOW.md'].map(async (name) => ({ name, ...await documentAt(root, name) })));
  return { name: path.basename(root), path: tildify(root), branch, files };
}

export async function uiState(cwd: string, sources: ClientAdapter[] = adapters) {
  const [status, registry, memory, instructions, repo, doctor] = await Promise.all([
    collectStatus(sources), readRegistry(), memoryDocuments(), documentAt(path.join(hubRoot(), 'instructions'), 'AGENTS.md'), workspace(cwd), cachedDoctor(),
  ]);
  const servers = Object.entries(registry.servers).sort(([a], [b]) => a.localeCompare(b)).map(([name, s]) => ({
    name, config: displayServer(name, s),
    references: [...new Set([...JSON.stringify(s).matchAll(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g)].map((m) => m[1]))],
  }));
  // Expose paths and comparison cells only, never args/headers from client snapshots.
  return { status, servers, memory, instructions, workspace: repo, doctor, updatedAt: new Date().toISOString() };
}

export async function skillDocument(name: string, source: string, sources: ClientAdapter[] = adapters) {
  const skills = source === 'hub' ? (await readHub()).skills : await (async () => {
    const adapter = sources.find((a) => a.id === source);
    if (!adapter) return [];
    return (await adapter.read()).skills;
  })();
  const skill = skills.find((s) => s.name === name);
  if (!skill) return null;
  return {
    name, source, path: tildify(skill.path), realPath: skill.realPath ? tildify(skill.realPath) : null,
    document: skill.realPath ? await documentAt(skill.realPath, 'SKILL.md') : { content: null, reason: 'Broken link.' },
  };
}
