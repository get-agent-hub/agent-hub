import type { HistoryCatalog, HistoryChat } from '../../contracts/history.js';
import { HubError } from '../../shared/errors.js';

export type HistoryAccess = { operator: true } | { grant: string };
export function visibleHistory(catalog: HistoryCatalog, access: HistoryAccess): HistoryChat[] {
  const grant = 'grant' in access ? catalog.grants.find((item) => item.id === access.grant) : null;
  if ('grant' in access && !grant)
    throw new HubError('History access was not granted or has been revoked.');
  return catalog.chats.filter(
    (chat) =>
      !catalog.deleted.includes(chat.id) &&
      !catalog.excluded.includes(chat.sourceId) &&
      !chat.projects.some((project) => catalog.excluded.includes(project)) &&
      (!grant ||
        (grant.sources.includes(chat.sourceId) &&
          chat.projects.length > 0 &&
          chat.projects.every((project) => grant.projects.includes(project)))),
  );
}
export function selectHistoryChat(catalog: HistoryCatalog, access: HistoryAccess, id: string) {
  const chat = visibleHistory(catalog, access).find((item) => item.id === id);
  if (!chat) throw new HubError('Conversation not found in the permitted scope.');
  return chat;
}
