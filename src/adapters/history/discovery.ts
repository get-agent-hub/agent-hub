import { createReadStream } from 'node:fs';
import type { ClientId, SessionDiscoveryControl, SessionScan } from '../../contracts/clients.js';
import { object, observeHistory, type NativeContext } from './events.js';
import { historyFiles, historySources } from './sources.js';
import { zstdFrames } from './zstd.js';

/** Metadata-only discovery shares native paths with the full reader; no raw archive is written. */
export async function discoverNativeHistory(
  client: ClientId,
  control: SessionDiscoveryControl = {},
): Promise<SessionScan> {
  const sources = (await historySources()).filter((source) => source.client === client);
  const result: SessionScan = {
    source: sources.map((source) => source.id).join(':'),
    coverage: 'complete',
    sessions: [],
    filesRead: 0,
    bytesRead: 0,
    finished: true,
    issues: [],
  };
  let found = false;
  for (const source of sources) {
    try {
      for await (const entry of historyFiles(source, control.signal)) {
        found = true;
        const context: NativeContext = {
          subagent: false,
          locations: new Set(),
          assets: new Set(),
          unsupported: false,
        };
        let pending = Buffer.alloc(0);
        const chunks = entry.relative.endsWith('.zstd')
          ? zstdFrames(entry.file, { bytes: 0, pending: false }, control.signal)
          : createReadStream(entry.file, { highWaterMark: 4096 });
        let read = 0;
        for await (const chunk of chunks) {
          control.signal?.throwIfAborted();
          read += chunk.length;
          result.bytesRead += chunk.length;
          pending = Buffer.concat([pending, chunk]);
          let end: number;
          while ((end = pending.indexOf(10)) >= 0) {
            try {
              const raw: unknown = JSON.parse(pending.subarray(0, end).toString('utf8'));
              observeHistory(context, { ...object(raw), content: undefined });
            } catch {
              /* A later valid header may still supply context. */
            }
            pending = pending.subarray(end + 1);
          }
          if (context.locations.size || read >= 1024 * 1024) break;
        }
        result.filesRead++;
        if (context.id && context.locations.size) {
          const session = { id: context.id, locations: [...context.locations] };
          if (control.onBatch)
            await control.onBatch({ ...result, sessions: [session], finished: false });
          else result.sessions.push(session);
        } else {
          result.coverage = 'partial';
          if (!result.issues.length)
            result.issues.push(
              'Some native files have no readable project metadata in the supported initial window.',
            );
        }
      }
    } catch (error) {
      control.signal?.throwIfAborted();
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        result.coverage = 'partial';
        result.issues.push('A native source could not be completely enumerated.');
      }
    }
  }
  if (!found && result.coverage === 'complete') result.coverage = 'not-found';
  if (control.onBatch) await control.onBatch({ ...result, sessions: [], finished: true });
  return result;
}
