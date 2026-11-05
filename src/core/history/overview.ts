import { historySources } from '../../adapters/history/sources.js';
import type { HistoryAccess } from './access.js';
import { visibleHistory } from './access.js';
import { readHistory } from './storage.js';

export async function historyOverview(root: string, access: HistoryAccess) {
  const catalog = await readHistory(root);
  const chats = visibleHistory(catalog, access);
  const projectIds = new Set(chats.flatMap((chat) => chat.projects));
  const projects = catalog.projects
    .filter((project) => 'operator' in access || projectIds.has(project.id))
    .map((project) => ({
      ...project,
      chats: chats.filter((chat) => chat.projects.includes(project.id)).length,
      excluded: catalog.excluded.includes(project.id),
    }));
  return {
    chats: chats.length,
    events: chats.reduce((total, chat) => total + chat.events, 0),
    bytes: chats.reduce((total, chat) => total + chat.bytes, 0),
    incomplete: chats.filter((chat) => chat.content !== 'complete').length,
    assetsMissing: chats.reduce(
      (total, chat) =>
        total +
        chat.assets.filter((asset) => asset.status !== 'preserved' && asset.status !== 'embedded')
          .length,
      0,
    ),
    projects,
    sources: 'operator' in access ? await historySources() : [],
    receipts: 'operator' in access ? catalog.receipts : [],
    excluded: 'operator' in access ? catalog.excluded : [],
    grants: 'operator' in access ? catalog.grants : [],
  };
}
