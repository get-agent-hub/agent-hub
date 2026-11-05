export const clientLabels = {
  hub: 'Hub',
  'claude-code': 'Claude Code',
  codex: 'Codex',
  dsh: 'DeepSeek Harness',
};
export const resources = {
  chats: 'Chats',
  skills: 'Skills',
  mcp: 'MCP servers',
  instructions: 'Instructions',
  memory: 'Memory',
};
export const destinations = {
  overview: 'Overview',
  data: 'All data',
  projects: 'Projects',
  sources: 'Sources & settings',
};

/** Old bookmarked resource routes remain readable; new links use the three-page hierarchy. */
export function readRoute(hash = location.hash) {
  const [name, search] = hash.replace(/^#\/?/, '').split('?');
  const params = new URLSearchParams(search);
  if (name === 'sessions' || Object.hasOwn(resources, name))
    return { page: 'data', resource: name === 'sessions' ? 'chats' : name, params };
  if (name === 'repos') return { page: 'projects', resource: 'repos', params };
  const page = Object.hasOwn(destinations, name) ? name : 'overview';
  return {
    page,
    resource:
      page === 'data'
        ? Object.hasOwn(resources, params.get('type'))
          ? params.get('type')
          : 'chats'
        : '',
    params,
  };
}

const paths = {
  overview:
    '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  data: '<path d="m3 6 9-4 9 4-9 4Zm0 6 9 4 9-4M3 18l9 4 9-4"/>',
  projects: '<path d="M3 6h7l2 2h9v12H3z"/>',
  sources: '<path d="M8 3v5m8-5v5M5 8h14v3a7 7 0 0 1-7 7v4m-7-11V8m14 3V8"/>',
  arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>',
};
export const icon = (name) =>
  `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${paths[name] || paths.data}</svg>`;
