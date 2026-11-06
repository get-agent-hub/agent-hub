import fs from 'node:fs/promises';
import type { HistoryChat, HistoryEvent } from '../../contracts/history.js';
import { titledHistoryChat } from './presentation.js';
import { ownedHistoryPath } from './storage.js';

type Summary = Pick<Awaited<ReturnType<typeof titledHistoryChat>>, 'title' | 'startedAt'> & {
  issue?: string;
};
const summaries = new Map<string, Promise<Summary>>();
const capacity = 1024;

async function indexStamp(root: string, chat: HistoryChat) {
  const file = await ownedHistoryPath(root, 'chats', chat.id, chat.revision, 'events.json');
  const stat = await fs.stat(file, { bigint: true });
  if (!stat.isFile()) throw new Error('Conversation index is unavailable.');
  return [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].join(':');
}

/** Cache derived captions only. Access and live catalog metadata remain the caller's responsibility. */
export async function historyChatSummary(
  root: string,
  chat: HistoryChat,
  events: () => AsyncIterable<HistoryEvent>,
) {
  let stamp: string;
  try {
    // Recheck ownership and descriptor identity even on hits: rebuilding an index keeps its raw revision.
    stamp = await indexStamp(root, chat);
  } catch {
    return titledHistoryChat(chat, events());
  }
  const key = JSON.stringify([
    root,
    chat.id,
    chat.revision,
    chat.title,
    chat.client,
    chat.nativeId,
    stamp,
  ]);
  let pending = summaries.get(key);
  if (pending) {
    summaries.delete(key);
    summaries.set(key, pending);
  } else {
    pending = (async () => {
      const result = await titledHistoryChat(chat, events());
      let reusable = result.issues === chat.issues;
      try {
        reusable &&= stamp === (await indexStamp(root, chat));
      } catch {
        reusable = false;
      }
      if (!reusable && summaries.get(key) === pending) summaries.delete(key);
      return {
        title: result.title,
        startedAt: result.startedAt,
        issue: result.issues.length > chat.issues.length ? result.issues.at(-1) : undefined,
      };
    })();
    summaries.set(key, pending);
    if (summaries.size > capacity) summaries.delete(summaries.keys().next().value!);
  }
  const { title, startedAt, issue } = await pending;
  // Never reuse projects, grants, exclusions, locations or coverage from a previous catalog read.
  return { ...chat, title, startedAt, issues: issue ? [...chat.issues, issue] : chat.issues };
}
