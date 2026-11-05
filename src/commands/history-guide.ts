import type { CommandGuide } from './catalog.js';
const operations = {
  'history connect':
    'Preview and connect a discovered project’s read-only history MCP to selected native clients, with guarded delivery and recovery.',
  history:
    'Preserve, browse and search complete native conversation events without changing active client sessions.',
  'history status':
    'Show persistent projects, archive size, source coverage, exclusions and connection grants.',
  'history scan':
    'Capture selected native history into private Hub storage, retaining raw originals and earlier revisions.',
  'history ls':
    'List preserved conversations, filtered by client or discovered project, with bounded pages.',
  'history search':
    'Search all indexed native event fields and retrieve source-qualified matching event references.',
  'history show':
    'Read a conversation window and follow its continuation without losing the complete underlying archive.',
  'history event':
    'Read every original field of a native event, including large tool results, in explicit character windows.',
  'history watch':
    'Periodically capture native updates while this foreground process runs; no OS service is installed.',
  'history rebuild':
    'Verify preserved raw history and rebuild derived event indexes without accessing native clients.',
  'history policy':
    'Preview or apply a reviewed exclusion, deletion, project label/alias or scoped connection grant.',
  'history serve':
    'Serve read-only archive retrieval over MCP using one persisted, revocable connection grant.',
};
export const historyGuide: CommandGuide[] = Object.entries(operations).map(
  ([command, purpose]) => ({
    command,
    purpose,
    level: command.endsWith('serve') ? 'integration' : 'advanced',
    audience: command.endsWith('serve')
      ? 'Native clients with an explicitly granted history connection.'
      : 'Users and scripts managing the shared conversation archive.',
  }),
);
