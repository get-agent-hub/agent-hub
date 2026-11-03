import fs from 'node:fs/promises';
import path from 'node:path';
import { autoDirectory, containsCredential, readAutomation } from './memory-auto-config.js';
import { scanNativeMemory } from './memory-auto-native.js';
import { automationAuthority } from './memory-auto-authority.js';
import { memoryFile, memoryPath } from './memory-store.js';
import { isRecord } from './values.js';
import { HubError } from './errors.js';

export async function autoStatus(root: string, workspace: string) {
  const { policy, location } = await readAutomation(root, workspace);
  const conflicts: { id: string; source: string; reason: string }[] = [];
  // Status probes current sources without retaining note bodies or changing synchronization state.
  const native = await Promise.all(
    policy.native.map(async (source) => {
      try {
        const scan = await scanNativeMemory(root, source);
        const rejected = scan.facts.filter((fact) =>
          containsCredential(`${fact.title}\n${fact.body}\n${fact.evidence}`),
        );
        return {
          ...source,
          importableFacts: scan.facts.length - rejected.length,
          notices: scan.notices,
          skipped: [
            ...scan.skipped,
            ...rejected.map((fact) => ({
              path: fact.source,
              reason: 'Possible credential detected; content was not retained.',
            })),
          ],
          error: null,
        };
      } catch (error) {
        return {
          ...source,
          importableFacts: 0,
          skipped: [],
          error:
            error instanceof HubError ? error.message : 'Cannot inspect this native memory source.',
        };
      }
    }),
  );
  // Older/restored tokens are no longer actionable, even if their local stage is requested.
  const authority = await automationAuthority(root).catch(() => null);
  let pending = 0;
  const latest = new Map<
    string,
    {
      client: string;
      hookAt: string | null;
      checkpointAt: string | null;
      submittedFacts: number | null;
    }
  >();
  for (const folder of ['conflicts', 'sessions']) {
    const directory = path.join(autoDirectory(location), folder);
    await memoryPath(root, directory, true);
    let files: string[];
    try {
      files = await fs.readdir(directory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      files = [];
    }
    if (files.length > 5000) throw new HubError('Automation status exceeds its metadata budget.');
    for (const name of files) {
      if (!/^[a-f0-9]{64}\.json$/.test(name))
        throw new HubError('Unexpected automation metadata file.');
      const file = await memoryFile(root, path.join(directory, name));
      if (file.text === null) continue;
      let value: unknown;
      try {
        value = JSON.parse(file.text);
      } catch {
        throw new HubError('Invalid automation status metadata.');
      }
      if (!isRecord(value)) throw new HubError('Invalid automation status metadata.');
      if (
        folder === 'conflicts' &&
        typeof value.id === 'string' &&
        typeof value.source === 'string' &&
        typeof value.reason === 'string'
      )
        conflicts.push({ id: value.id, source: value.source, reason: value.reason });
      if (
        folder === 'sessions' &&
        typeof value.client === 'string' &&
        authority !== null &&
        value.authority === authority
      ) {
        const time = (value: unknown) =>
          typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null;
        const previous = latest.get(value.client);
        const hookAt = time(value.hookAt);
        const checkpointAt = time(value.checkpointAt);
        latest.set(value.client, {
          client: value.client,
          hookAt:
            hookAt && (!previous?.hookAt || hookAt > previous.hookAt)
              ? hookAt
              : (previous?.hookAt ?? null),
          checkpointAt:
            checkpointAt && (!previous?.checkpointAt || checkpointAt > previous.checkpointAt)
              ? checkpointAt
              : (previous?.checkpointAt ?? null),
          submittedFacts:
            checkpointAt &&
            (!previous?.checkpointAt || checkpointAt > previous.checkpointAt) &&
            typeof value.submittedFacts === 'number'
              ? value.submittedFacts
              : (previous?.submittedFacts ?? null),
        });
      }
      if (
        folder === 'sessions' &&
        value.stage === 'requested' &&
        authority !== null &&
        value.authority === authority &&
        typeof value.expires === 'number' &&
        value.expires >= Date.now()
      )
        pending++;
    }
  }
  return {
    scope: location.scope,
    policy,
    native,
    conflicts,
    pendingCheckpoints: pending,
    activity: [...latest.values()],
  };
}
