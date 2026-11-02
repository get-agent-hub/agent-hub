import path from 'node:path';
import { parse } from 'yaml';
import { readOptionalText } from './file-store.js';
import { HubError } from './errors.js';
import { isRecord } from './values.js';
import type { ClientId } from './types.js';

export interface HubSettings {
  version: 1;
  clients?: Partial<Record<ClientId, { enabled?: boolean; profile?: string }>>;
}

export async function readSettings(root: string, optional = false): Promise<HubSettings> {
  const text = await readOptionalText(path.join(root, 'hub.yaml'));
  if (text === null) {
    if (optional) return { version: 1 };
    throw new HubError('Hub is not initialized. Run ahub init first.');
  }
  try {
    const doc: unknown = parse(text);
    if (
      !isRecord(doc) ||
      doc.version !== 1 ||
      (doc.clients !== undefined && !isRecord(doc.clients))
    )
      throw new Error();
    for (const client of Object.values(doc.clients ?? {})) {
      if (
        !isRecord(client) ||
        (client.enabled !== undefined && typeof client.enabled !== 'boolean') ||
        (client.profile !== undefined && typeof client.profile !== 'string')
      )
        throw new Error();
    }
    return doc as unknown as HubSettings;
  } catch {
    throw new HubError('Cannot parse hub.yaml. Check the settings schema.');
  }
}

export function dshProfile(settings: HubSettings): string {
  const profile = process.env.AGENT_HUB_DSH_PROFILE ?? settings.clients?.dsh?.profile ?? 'web';
  if (!/^[\w-]+$/.test(profile)) throw new HubError('Invalid DSH profile name.');
  return profile;
}
