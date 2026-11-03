import fs from 'node:fs/promises';
import path from 'node:path';
import { clientPaths, expandHome } from './paths.js';
import { memoryCheckout, memoryRegistry } from './memory-projects.js';
import { readAutomation } from './memory-auto-config.js';
import { hash, isRecord } from './values.js';
import { HubError } from './errors.js';
import type { ClientId } from './types.js';

export interface MemorySource {
  id: string;
  client: ClientId;
  path: string;
  format: 'markdown' | 'unsupported';
  project: string | null;
  projectId: string | null;
  evidence: string;
}
export interface MemoryDiscovery {
  workspace: string;
  project: string | null;
  sources: MemorySource[];
  warnings: string[];
}

async function entries(directory: string) {
  try {
    const stat = await fs.lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw new HubError('Discovery requires real directories; symlink preserved.');
    const items = await fs.readdir(directory, { withFileTypes: true });
    if (items.length > 2000)
      throw new HubError('Memory discovery directory exceeds its entry budget.');
    return items.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}
async function objectFile(file: string) {
  try {
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 256 * 1024) throw new Error();
    const value: unknown = JSON.parse(await fs.readFile(file, 'utf8'));
    if (!isRecord(value)) throw new Error();
    return value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new HubError('Cannot inspect memory settings; file must be bounded JSON.');
  }
}

/** Read only bounded metadata prefixes; never archive, extract or return conversation text. */
async function claudeWorkspace(
  directory: string,
  budget: { bytes: number },
  checkout: (cwd: string) => Promise<string | null>,
) {
  const logs = (await entries(directory)).filter(
    (item) => item.isFile() && item.name.endsWith('.jsonl'),
  );
  if (!logs.length || logs.length > 50) return null;
  const roots = new Set<string>();
  for (const item of logs) {
    if (budget.bytes < 64 * 1024) return null;
    const file = await fs.open(path.join(directory, item.name), 'r');
    let text: string;
    try {
      const buffer = Buffer.alloc(64 * 1024);
      const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
      budget.bytes -= buffer.length;
      text = buffer.subarray(0, bytesRead).toString('utf8');
    } finally {
      await file.close();
    }
    let found = false;
    for (const line of text.split('\n').slice(0, 16)) {
      let value: unknown;
      try {
        value = JSON.parse(line);
      } catch {
        continue;
      }
      if (isRecord(value) && typeof value.cwd === 'string' && path.isAbsolute(value.cwd)) {
        const root = await checkout(value.cwd);
        if (!root) return null;
        roots.add(root);
        found = true;
      }
    }
    if (!found || roots.size > 1) return null;
  }
  return roots.size === 1 ? [...roots][0]! : null;
}

export async function discoverMemory(root: string, workspace: string): Promise<MemoryDiscovery> {
  const selected = await memoryCheckout(workspace);
  const { registry } = await memoryRegistry(root);
  const project =
    registry.projects.find((item) => item.checkouts.some((item) => item.path === selected))?.id ??
    null;
  const sources = new Map<string, MemorySource>();
  const warnings: string[] = [];
  const budget = { bytes: 4 * 1024 * 1024 };
  const cache = new Map<string, Promise<string | null>>();
  const checkout = (cwd: string) => {
    if (!cache.has(cwd))
      cache.set(
        cwd,
        memoryCheckout(cwd).catch(() => null),
      );
    return cache.get(cwd)!;
  };
  const add = async (
    client: ClientId,
    candidate: string,
    mapped: string | null,
    evidence: string,
    format: MemorySource['format'] = 'markdown',
  ) => {
    const file = path.resolve(expandHome(candidate));
    let stat;
    try {
      stat = await fs.lstat(file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
    if (stat.isSymbolicLink()) {
      warnings.push('Memory source symlink preserved: ' + file);
      return;
    }
    if (format === 'markdown' ? !stat.isDirectory() : !stat.isFile()) return;
    const physical = await fs.realpath(file);
    const id = 'source-' + hash(client + ':' + physical).slice(0, 24);
    const prior = sources.get(id);
    if (physical !== file && mapped !== null) {
      mapped = null;
      evidence += ' Physical directory binding differs; choose its scope explicitly.';
    }
    if (!prior || mapped === selected)
      sources.set(id, {
        id,
        client,
        path: physical,
        format,
        project: mapped,
        projectId:
          registry.projects.find((item) =>
            item.checkouts.some((checkout) => checkout.path === mapped),
          )?.id ?? null,
        evidence,
      });
  };
  const inspect = async (label: string, work: () => Promise<void>) => {
    try {
      await work();
    } catch (error) {
      warnings.push(
        label +
          ': ' +
          (error instanceof HubError ? error.message : 'Cannot inspect this memory location.'),
      );
    }
  };
  const homes = {
    'claude-code': path.resolve(expandHome(clientPaths.claudeHome())),
    codex: path.resolve(expandHome(clientPaths.codexHome())),
    dsh: path.resolve(expandHome(clientPaths.dshHome())),
  };
  await inspect('Configured sources', async () => {
    if (!project) return;
    const { policy } = await readAutomation(root, selected);
    for (const source of policy.native)
      await add(source.client, source.directory, selected, 'Already bound to this Hub project.');
  });
  for (const [client, home] of Object.entries(homes) as [ClientId, string][]) {
    await inspect(client, async () => {
      for (const name of ['memory', 'memories']) {
        await add(
          client,
          path.join(home, name),
          null,
          'Client-wide collection; choose a project explicitly before importing.',
        );
        const local = path.join(
          selected,
          client === 'claude-code' ? '.claude' : client === 'codex' ? '.codex' : '.dsh',
          name,
        );
        await add(
          client,
          local,
          selected,
          'Workspace-local memory directory; review its project scope.',
        );
      }
      if (client === 'codex') {
        for (const file of await entries(home))
          if (file.isFile() && /^memories_.*\.sqlite$/.test(file.name))
            await add(
              client,
              path.join(home, file.name),
              null,
              'Native SQLite schema is not imported. Export selected knowledge to Markdown; no database content was read.',
              'unsupported',
            );
      }
    });
  }
  await inspect('Claude settings', async () => {
    for (const file of [
      path.join(homes['claude-code'], 'settings.json'),
      path.join(selected, '.claude', 'settings.json'),
      path.join(selected, '.claude', 'settings.local.json'),
    ]) {
      const settings = await objectFile(file);
      if (typeof settings?.autoMemoryDirectory !== 'string') continue;
      const directory = expandHome(settings.autoMemoryDirectory);
      if (!path.isAbsolute(directory)) {
        warnings.push('Relative autoMemoryDirectory needs explicit source selection: ' + file);
        continue;
      }
      const local = file.startsWith(selected + path.sep) && (await fs.realpath(file)) === file;
      await add(
        'claude-code',
        directory,
        local ? selected : null,
        'Explicit autoMemoryDirectory in ' +
          file +
          (local ? '' : '; global setting does not prove project scope.'),
      );
    }
  });
  await inspect('Claude project collections', async () => {
    const projects = path.join(homes['claude-code'], 'projects');
    for (const item of await entries(projects)) {
      if (!item.isDirectory() || item.name.startsWith('.')) continue;
      const collection = path.join(projects, item.name);
      let stat;
      try {
        stat = await fs.lstat(path.join(collection, 'memory'));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
        throw error;
      }
      if (!stat.isDirectory() || stat.isSymbolicLink()) continue;
      const mapped = await claudeWorkspace(collection, budget, checkout);
      await add(
        'claude-code',
        path.join(collection, 'memory'),
        mapped,
        mapped
          ? 'Consistent Git checkout from bounded session cwd metadata; folder name was not decoded.'
          : 'Project association unresolved or discovery budget exceeded; select this source explicitly.',
      );
    }
  });
  return {
    workspace: selected,
    project,
    sources: [...sources.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    warnings,
  };
}
