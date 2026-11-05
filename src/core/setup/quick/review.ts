import type { ReviewRow } from './types.js';
export const titles = {
  init: 'Create or adopt Hub',
  mcpImport: 'Collect MCP definitions and protect credentials',
  skillImport: 'Collect complete skill bundles',
  project: 'Bind project memory',
  memory: 'Import existing project Markdown memory',
  automation: 'Enable project memory and install lifecycle hooks',
  delivery: 'Deliver MCP, skills and shared context to clients',
};
export const reviewRows = (rows: ReviewRow[]) =>
  rows.filter(
    (row) =>
      ['conflict', 'error'].includes(row.action) ||
      (row.action === 'preserve' && row.client === 'memory'),
  );
