import fs from 'node:fs/promises';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { HistoryFile, HistorySource } from '../../contracts/history.js';
import { clientPaths, expandHome } from '../../shared/paths.js';
import { hash } from '../../shared/values.js';

export function historySource(client: HistorySource['client'], root: string): HistorySource {
  root = path.resolve(root);
  return {
    id: hash(`${client}\0${root}`),
    client,
    root,
    label: client,
    layout: client === 'claude-code' ? 'claude' : client,
  };
}

/** Known native roots only. Profile YAML is data; plugins and substitutions are never executed. */
export async function historySources(): Promise<HistorySource[]> {
  const roots = [
    historySource('claude-code', path.join(clientPaths.claudeHome(), 'projects')),
    historySource('codex', clientPaths.codexHome()),
    historySource('dsh', path.join(clientPaths.dshHome(), 'sessions')),
  ];
  const profiles = path.join(clientPaths.dshHome(), 'profiles');
  try {
    for (const profile of await fs.readdir(profiles, { withFileTypes: true })) {
      if (!profile.isDirectory() || profile.isSymbolicLink()) continue;
      const file = path.join(profiles, profile.name, 'cordis.patch.yml');
      try {
        if ((await fs.lstat(file)).isSymbolicLink() || (await fs.stat(file)).size > 1024 * 1024)
          continue;
        const value: unknown = parseYaml(await fs.readFile(file, 'utf8'), {
          logLevel: 'silent',
          maxAliasCount: 50,
        });
        const pending = [value];
        const seen = new WeakSet<object>();
        while (pending.length) {
          const item = pending.pop();
          if (!item || typeof item !== 'object') continue;
          if (seen.has(item)) continue;
          seen.add(item);
          const plugin = item as { name?: unknown; config?: { root?: unknown } };
          if (
            typeof plugin.name === 'string' &&
            plugin.name.endsWith('session-persistence-jsonl') &&
            typeof plugin.config?.root === 'string' &&
            !plugin.config.root.includes('${') &&
            path.isAbsolute(expandHome(plugin.config.root))
          )
            roots.push(historySource('dsh', expandHome(plugin.config.root)));
          for (const [key, config] of Object.entries(item)) {
            if (
              key.split(':')[0] === 'session-persistence-jsonl' &&
              config &&
              typeof config === 'object'
            ) {
              const root: unknown = (config as Record<string, unknown>).root;
              if (
                typeof root === 'string' &&
                !root.includes('${') &&
                path.isAbsolute(expandHome(root))
              )
                roots.push(historySource('dsh', expandHome(root)));
            }
            if (config && typeof config === 'object') pending.push(config);
          }
        }
      } catch {
        /* A malformed profile does not block independent known roots. */
      }
    }
  } catch {
    /* Missing profile directory is common before DSH setup. */
  }
  const resolved = await Promise.all(
    roots.map(async (source) =>
      historySource(source.client, await fs.realpath(source.root).catch(() => source.root)),
    ),
  );
  return [...new Map(resolved.map((source) => [source.id, source])).values()];
}

/** Walk only a declared store layout. Never follow source links or descend into project code. */
export async function* historyFiles(
  source: HistorySource,
  signal?: AbortSignal,
): AsyncGenerator<HistoryFile> {
  const root = await fs.realpath(source.root);
  const depth = source.layout === 'claude' ? 4 : source.layout === 'codex' ? 5 : 3;
  async function* walk(directory: string, left: number): AsyncGenerator<HistoryFile> {
    signal?.throwIfAborted();
    const binding = await fs.realpath(directory);
    const before = await fs.stat(directory);
    if (binding !== root && !binding.startsWith(root + path.sep))
      throw new Error('Source binding changed.');
    const entries = await fs.readdir(directory, { withFileTypes: true });
    const generations = entries.filter(
      (entry) =>
        entry.isFile() && /^session(?:\.v[1-9][0-9]*)?\.jsonl(?:\.zstd)?$/.test(entry.name),
    );
    const generation = (name: string) => Number(name.match(/\.v([0-9]+)\./)?.[1] ?? 0);
    const newest = generations.sort((a, b) => generation(b.name) - generation(a.name))[0]?.name;
    const handle = await fs.opendir(directory);
    for await (const entry of handle) {
      signal?.throwIfAborted();
      const file = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory() && left > 0) {
        if (
          directory === source.root &&
          source.layout === 'codex' &&
          !['sessions', 'archived_sessions'].includes(entry.name)
        )
          continue;
        yield* walk(file, left - 1);
      } else if (
        entry.isFile() &&
        (entry.name.endsWith('.jsonl') ||
          (source.layout === 'dsh' && entry.name.endsWith('.jsonl.zstd')))
      ) {
        if (source.layout === 'dsh' && entry.name !== newest) continue;
        yield { source, file, relative: path.relative(source.root, file) };
      }
    }
    if (
      before.mtimeMs !== (await fs.stat(directory)).mtimeMs ||
      binding !== (await fs.realpath(directory))
    )
      throw new Error('Source directory changed during enumeration.');
  }
  yield* walk(source.root, depth);
}
