import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { HubError } from '../../shared/errors.js';
import { withHubLock } from '../../shared/hub-lock.js';
import { hash, stableStringify } from '../../shared/values.js';
import { ensureBaseline } from '../recovery/baseline.js';
import { ownedHistoryPath, readHistory, writeHistory } from './storage.js';
import { collectHistoryObjects } from './collect.js';

const id = z.string().regex(/^[a-f0-9]{64}$/);
const policySchema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('exclude'), id, excluded: z.boolean() }).strict(),
  z.object({ operation: z.literal('forget'), id }).strict(),
  z
    .object({ operation: z.literal('label'), id, label: z.string().trim().min(1).max(200) })
    .strict(),
  z.object({ operation: z.literal('alias'), id, directory: z.string().min(1).max(4096) }).strict(),
  z
    .object({
      operation: z.literal('grant'),
      id: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),
      projects: z.array(id).min(1),
      sources: z.array(id).min(1),
    })
    .strict(),
  z
    .object({ operation: z.literal('revoke'), id: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/) })
    .strict(),
]);
export type HistoryPolicy = z.infer<typeof policySchema>;
export async function planHistoryPolicy(root: string, input: unknown) {
  const parsed = policySchema.safeParse(input);
  if (!parsed.success)
    throw new HubError('Invalid history policy. Choose a known item and supported operation.');
  const change = parsed.data;
  const catalog = await readHistory(root);
  const next = structuredClone(catalog);
  const project = next.projects.find((item) => item.id === change.id);
  const chat = next.chats.find((item) => item.id === change.id);
  if (change.operation === 'exclude') {
    if (!project && !next.sources.some((item) => item.id === change.id))
      throw new HubError('Unknown source or project.');
    next.excluded = change.excluded
      ? [...new Set([...next.excluded, change.id])]
      : next.excluded.filter((item) => item !== change.id);
  } else if (change.operation === 'forget') {
    if (!chat) throw new HubError('Unknown conversation.');
    next.chats = next.chats.filter((item) => item.id !== change.id);
    next.deleted = [...new Set([...next.deleted, change.id])];
    next.tombstones.push({
      id: chat.id,
      sourceId: chat.sourceId,
      relative: chat.relative,
      nativeId: chat.nativeId,
      sourceStamp: chat.sourceStamp,
    });
  } else if (change.operation === 'label') {
    if (!project) throw new HubError('Unknown project.');
    project.label = change.label;
  } else if (change.operation === 'alias') {
    if (!project || !path.isAbsolute(change.directory))
      throw new HubError('Choose a known project and absolute local directory.');
    if (
      next.projects.some(
        (item) =>
          item.id !== project.id && [...item.locations, ...item.aliases].includes(change.directory),
      )
    )
      throw new HubError('This location already belongs to another project.');
    project.aliases = [...new Set([...project.aliases, change.directory])];
  } else if (change.operation === 'grant') {
    if (
      change.projects.some((item) => !next.projects.some((p) => p.id === item)) ||
      change.sources.some((item) => !next.sources.some((s) => s.id === item))
    )
      throw new HubError('Choose known projects and sources for this connection.');
    next.grants = [
      ...next.grants.filter((item) => item.id !== change.id),
      {
        id: change.id,
        projects: [...new Set(change.projects)],
        sources: [...new Set(change.sources)],
      },
    ];
  } else next.grants = next.grants.filter((item) => item.id !== change.id);
  return {
    change,
    revision: hash(stableStringify({ catalog, change })),
    next,
    note:
      change.operation === 'forget'
        ? 'Remove this conversation from the archive and prevent reimport. Native originals and older recovery copies are retained; this is not secure erasure.'
        : 'Update archive policy only. Native clients and project memory are unchanged.',
  };
}
export async function applyHistoryPolicy(root: string, input: unknown, expect: string) {
  await ownedHistoryPath(root);
  return withHubLock(root, async (origin) => {
    const plan = await planHistoryPolicy(root, input);
    if (plan.revision !== expect)
      throw new HubError('History changed since preview. Review a fresh policy plan.');
    await ensureBaseline(root, [], origin);
    await writeHistory(root, plan.next);
    let retainedFiles = false;
    if (plan.change.operation === 'forget') {
      const directory = await ownedHistoryPath(root, 'chats', plan.change.id);
      try {
        await fs.rm(directory, { recursive: true, force: true });
        await collectHistoryObjects(root);
      } catch {
        retainedFiles = true;
      }
    }
    return { applied: true, retainedFiles, note: plan.note };
  });
}
