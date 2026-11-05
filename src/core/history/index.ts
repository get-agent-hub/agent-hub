import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { historyEvent, observeHistory, type NativeContext } from '../../adapters/history/events.js';
import { zstdFrames } from '../../adapters/history/zstd.js';
import type { HistoryChat } from '../../contracts/history.js';

const recordCapacity = 16 * 1024 * 1024;
export interface IndexResult {
  context: NativeContext;
  events: number;
  indexedBytes: number;
  content: HistoryChat['content'];
  issues: string[];
}

/** Raw bytes are already private and durable; failure here never acknowledges an absent archive. */
export async function indexHistory(
  rawFile: string,
  indexFile: string,
  compressed: boolean,
  signal?: AbortSignal,
): Promise<IndexResult> {
  const context: NativeContext = {
    subagent: false,
    locations: new Set(),
    assets: new Set(),
    unsupported: false,
  };
  const result: IndexResult = {
    context,
    events: 0,
    indexedBytes: 0,
    content: 'complete',
    issues: [],
  };
  const output = await fs.open(indexFile, 'wx', 0o600);
  const frameProgress = { pending: false, bytes: 0 };
  const chunks = compressed
    ? zstdFrames(rawFile, frameProgress, signal)
    : createReadStream(rawFile, { highWaterMark: 64 * 1024 });
  let fragments: Buffer[] = [];
  let size = 0;
  let offset = 0;
  let oversized = false;
  try {
    for await (const chunk of chunks) {
      signal?.throwIfAborted();
      const data = Buffer.from(chunk);
      let start = 0;
      for (let end = data.indexOf(10); end !== -1; end = data.indexOf(10, start)) {
        const part = data.subarray(start, end);
        if (!oversized && size + part.length <= recordCapacity) fragments.push(part);
        else oversized = true;
        if (oversized) {
          result.content = 'partial';
          if (
            !result.issues.includes(
              'An oversized event is preserved in raw history but cannot be indexed.',
            )
          )
            result.issues.push(
              'An oversized event is preserved in raw history but cannot be indexed.',
            );
        } else {
          const line = Buffer.concat(fragments);
          if (line.length) {
            let raw: unknown;
            let valid = true;
            try {
              raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(line));
            } catch {
              valid = false;
              result.content = 'partial';
              if (
                !result.issues.includes('Malformed native events remain available in raw history.')
              )
                result.issues.push('Malformed native events remain available in raw history.');
            }
            if (valid) {
              observeHistory(context, raw);
              const event = historyEvent(raw, result.events);
              await output.writeFile(JSON.stringify(event) + '\n');
              result.events++;
            }
          }
        }
        offset += size + part.length + 1;
        result.indexedBytes = offset;
        fragments = [];
        size = 0;
        oversized = false;
        start = end + 1;
      }
      const remaining = data.subarray(start);
      size += remaining.length;
      if (size <= recordCapacity && !oversized) fragments.push(remaining);
      else oversized = true;
    }
    if (size || frameProgress.pending) {
      if (result.content === 'complete') result.content = 'pending-tail';
      result.issues.push(
        'A final incomplete record or compressed frame is preserved and will be retried.',
      );
    }
    if (context.unsupported) {
      result.content = 'unsupported';
      result.issues.push(
        'Newer native format: raw events are preserved without claiming compatible interpretation.',
      );
    }
    await output.sync();
    return result;
  } catch (error) {
    signal?.throwIfAborted();
    if (typeof (error as NodeJS.ErrnoException).code === 'string') throw error;
    result.content = 'unsupported';
    result.issues.push(
      'An event or compressed frame could not be interpreted. Raw bytes and the readable event prefix are retained.',
    );
    await output.sync();
    return result;
  } finally {
    await output.close();
  }
}
