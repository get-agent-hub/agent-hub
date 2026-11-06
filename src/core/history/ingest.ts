import fs from 'node:fs/promises';
import path from 'node:path';
import { historyFiles, historySources } from '../../adapters/history/sources.js';
import type {
  HistoryCatalog,
  HistoryChat,
  HistoryControl,
  HistoryFile,
  HistoryReceipt,
  HistorySource,
} from '../../contracts/history.js';
import { withHubLock } from '../../shared/hub-lock.js';
import { hash } from '../../shared/values.js';
import { ensureBaseline } from '../recovery/baseline.js';
import { preserveHistoryAssets } from './assets.js';
import { captureHistory, sourceStamp } from './capture.js';
import { indexHistory } from './index.js';
import { associateHistoryProjects, type HistoryLocationCache } from './projects.js';
import { preserveRaw } from './raw.js';
import { publishHistoryGeneration } from './publish.js';
import { ownedHistoryPath, readHistory, revisionDirectory, writeHistory } from './storage.js';

export async function ingestHistory(
  root: string,
  sources?: HistorySource[],
  control: HistoryControl = {},
) {
  await ownedHistoryPath(root);
  return withHubLock(root, async (origin) => {
    await ensureBaseline(root, [], origin);
    const catalog = await readHistory(root);
    const locations: HistoryLocationCache = new Map();
    for (const source of sources ?? (await historySources())) {
      control.signal?.throwIfAborted();
      if (catalog.excluded.includes(source.id)) continue;
      if (!catalog.sources.some((item) => item.id === source.id)) catalog.sources.push(source);
      const receipt: HistoryReceipt = {
        source,
        coverage: 'complete',
        checked: 0,
        changed: 0,
        bytes: 0,
        issues: [],
        checkedAt: new Date().toISOString(),
        succeededAt: catalog.receipts.find((item) => item.source.id === source.id)?.succeededAt,
      };
      try {
        const before = await fs.stat(source.root);
        const binding = `${before.dev}:${before.ino}`;
        const registered = catalog.sources.find((item) => item.id === source.id)!;
        if (
          (registered.binding && registered.binding !== binding) ||
          (source.binding && source.binding !== binding)
        )
          throw new Error('Source binding changed.');
        registered.binding = binding;
        for await (const file of historyFiles(source, control.signal)) {
          control.signal?.throwIfAborted();
          receipt.checked++;
          try {
            const changed = await ingestFile(root, catalog, file, locations, control.signal);
            receipt.changed += changed ? 1 : 0;
            receipt.bytes += changed?.bytes ?? 0;
            if (changed && changed.content !== 'complete') receipt.coverage = 'partial';
            if (
              catalog.chats.some(
                (chat) =>
                  chat.sourceId === source.id &&
                  chat.relative === file.relative &&
                  chat.content !== 'complete',
              )
            )
              receipt.coverage = 'partial';
          } catch {
            control.signal?.throwIfAborted();
            receipt.coverage = 'partial';
            if (!receipt.issues.length)
              receipt.issues.push(
                'A conversation could not be captured. Its last saved version is retained; retry after checking source access.',
              );
          }
          control.onProgress?.({ ...receipt, issues: [...receipt.issues] });
        }
        if (before.mtimeMs !== (await fs.stat(source.root)).mtimeMs) {
          receipt.coverage = 'partial';
          receipt.issues.push(
            'The source directory changed during the scan. Refresh to discover additions.',
          );
        }
      } catch (error) {
        control.signal?.throwIfAborted();
        receipt.coverage =
          (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'not-found' : 'unavailable';
        receipt.issues.push(
          'Source enumeration did not finish. Archived conversations were retained.',
        );
      }
      if (receipt.coverage === 'complete') receipt.succeededAt = new Date().toISOString();
      catalog.receipts = [
        ...catalog.receipts.filter((item) => item.source.id !== source.id),
        receipt,
      ];
      await writeHistory(root, catalog);
      control.onProgress?.(receipt);
    }
    return catalog;
  });
}

async function ingestFile(
  root: string,
  catalog: HistoryCatalog,
  source: HistoryFile,
  locations: HistoryLocationCache,
  signal?: AbortSignal,
): Promise<HistoryChat | null> {
  const logical = source.source.layout === 'dsh' ? path.dirname(source.relative) : source.relative;
  let id = hash(`${source.source.id}\0${logical}`);
  let previous = catalog.chats.find((chat) => chat.id === id);
  if (previous?.projects.some((project) => catalog.excluded.includes(project))) return null;
  const currentStamp = sourceStamp(await fs.stat(source.file, { bigint: true }));
  if (
    catalog.tombstones.some(
      (item) =>
        item.sourceId === source.source.id &&
        item.relative === source.relative &&
        item.sourceStamp === currentStamp,
    )
  )
    return null;
  if (
    previous?.sourceStamp &&
    previous.sourceStamp === currentStamp &&
    previous.content === 'complete' &&
    !previous.assets.some((asset) => asset.status === 'missing')
  ) {
    try {
      await fs.access(await ownedHistoryPath(root, 'chats', id, previous.revision, 'events.json'));
      return null;
    } catch {
      /* A missing derived index must be repaired below. */
    }
  }
  const captured = await captureHistory(root, source, signal);
  let staging: string | undefined;
  try {
    if (previous?.revision === captured.revision) {
      // Rebuild derived data or retry assets when a previous pass was incomplete.
      const index = path.join(await revisionDirectory(root, id, previous.revision), 'events.json');
      try {
        if (
          previous.content === 'complete' &&
          previous.assets.every((asset) =>
            ['preserved', 'embedded', 'remote', 'outside-source'].includes(asset.status),
          ) &&
          (await fs.stat(index)).isFile()
        )
          return null;
      } catch {
        /* Missing indexes can be rebuilt from a fresh checked capture. */
      }
    }
    staging = captured.file + '-generation';
    await fs.mkdir(staging, { mode: 0o700 });
    await fs.rename(captured.file, path.join(staging, 'raw'));
    let indexed;
    try {
      indexed = await indexHistory(
        path.join(staging, 'raw'),
        path.join(staging, 'events.jsonl'),
        source.relative.endsWith('.zstd'),
        signal,
      );
    } catch (error) {
      signal?.throwIfAborted();
      // Preserve unsupported/corrupt encodings as raw history without replacing readable text with a false success.
      if (!source.relative.endsWith('.zstd')) throw error;
      if (typeof (error as NodeJS.ErrnoException).code === 'string') throw error;
      indexed = {
        context: {
          subagent: false,
          locations: new Set<string>(),
          assets: new Set<string>(),
          unsupported: true,
        },
        events: 0,
        indexedBytes: 0,
        content: 'unsupported' as const,
        issues: [
          'Compressed history was preserved, but decoding failed. Its content is not claimed complete.',
        ],
      };
    }
    const nativeId = indexed.context.id ?? path.basename(logical, '.jsonl');
    if (
      catalog.tombstones.some(
        (item) =>
          item.sourceId === source.source.id &&
          item.relative === source.relative &&
          item.nativeId === nativeId,
      )
    )
      return null;
    if (
      catalog.deleted.includes(id) ||
      (previous && indexed.context.id && previous.nativeId !== indexed.context.id)
    ) {
      id = hash(`${source.source.id}\0${logical}\0${indexed.context.id}`);
      previous = catalog.chats.find((chat) => chat.id === id);
    }
    if (catalog.deleted.includes(id)) return null;
    for (const location of previous?.locations ?? []) indexed.context.locations.add(location);
    const projects = [
      ...new Set([
        ...(previous?.projects ?? []),
        ...(await associateHistoryProjects(catalog, indexed.context.locations, signal, locations)),
      ]),
    ];
    if (!captured.sourceStamp && indexed.content === 'complete') {
      indexed.content = 'pending-tail';
      indexed.issues.push(
        'The native file changed while its checked prefix was captured. Refresh to capture later data.',
      );
    }
    if (projects.some((project) => catalog.excluded.includes(project))) return null;
    const assets = await preserveHistoryAssets(
      indexed.context.assets,
      source.source.root,
      source.file,
      path.join(staging, 'assets'),
      signal,
    );
    const chat: HistoryChat = {
      id,
      sourceId: source.source.id,
      client: source.source.client,
      nativeId: indexed.context.id ?? path.basename(logical, '.jsonl'),
      relative: source.relative,
      title:
        indexed.context.title ??
        previous?.title ??
        `Conversation ${indexed.context.id ?? path.basename(logical, '.jsonl')}`,
      parentNativeId:
        indexed.context.parent ??
        (source.relative.includes(`${path.sep}subagents${path.sep}`)
          ? path.basename(path.dirname(path.dirname(source.relative)))
          : null),
      kind:
        indexed.context.subagent || source.relative.includes(`${path.sep}subagents${path.sep}`)
          ? 'subagent'
          : 'chat',
      locations: [...indexed.context.locations],
      projects,
      revision: captured.revision,
      revisions: [...new Set([...(previous?.revisions ?? []), captured.revision])],
      events: indexed.events,
      bytes: captured.bytes,
      indexedBytes: indexed.indexedBytes,
      content: indexed.content,
      assets,
      issues: indexed.issues,
      observedAt: new Date().toISOString(),
      sourceStamp: captured.sourceStamp,
    };
    await preserveRaw(root, path.join(staging, 'raw'), staging, signal);
    await preserveRaw(root, path.join(staging, 'events.jsonl'), staging, signal, 'events');
    await fs.rm(path.join(staging, 'raw'));
    await fs.rm(path.join(staging, 'events.jsonl'));
    await fs.writeFile(
      path.join(staging, 'manifest.json'),
      JSON.stringify({ version: 1, source: source.source, chat }),
      { flag: 'wx', mode: 0o600 },
    );
    const destination = await revisionDirectory(root, id, captured.revision);
    await fs.mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
    await publishHistoryGeneration(root, staging, destination, chat);
    catalog.chats = [...catalog.chats.filter((item) => item.id !== id), chat];
    // Acknowledgement follows a complete generation. A crash before this write leaves a recoverable orphan only.
    await writeHistory(root, catalog);
    return chat;
  } finally {
    await fs.rm(captured.file, { force: true });
    if (staging) await fs.rm(staging, { recursive: true, force: true });
  }
}
