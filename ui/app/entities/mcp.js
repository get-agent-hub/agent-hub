export const mcpFieldLabels = {
  command: 'program',
  args: 'launch arguments',
  url: 'server address',
  cwd: 'working folder',
  env: 'environment or credentials',
  headers: 'authentication headers',
  transport: 'connection type',
  other: 'other launch settings',
};

export function mcpTargets(state, name) {
  const server = state.servers.find((item) => item.name === name);
  return state.status.clients.filter(
    (client) =>
      client.installed &&
      (!state.quickClients || state.quickClients.includes(client.id)) &&
      (!server?.config.only || server.config.only.includes(client.id)),
  );
}

export function mcpSetup(row, state) {
  const clients = mcpTargets(state, row.name);
  const copies = [row.cells.hub, ...clients.map((client) => row.cells[client.id])].filter(Boolean);
  const different = new Set(copies).size > 1;
  if (different)
    return {
      kind: 'choice',
      label: 'Settings differ',
      tone: 'warn',
      description:
        'The same server has different settings. Choose which copy you want in Hub, or keep separate client settings.',
    };
  if (!row.cells.hub)
    return {
      kind: 'collect',
      label: 'Not in Hub',
      tone: '',
      description:
        'This server is configured in a client. Add a working copy to Hub before connecting other clients.',
    };
  if (clients.some((client) => !row.cells[client.id]))
    return {
      kind: 'connect',
      label: 'Ready to connect',
      tone: '',
      description: 'Hub has this server. Some selected clients do not have it yet.',
    };
  return {
    kind: 'matching',
    label: 'Settings match',
    tone: 'ok',
    description:
      'The launch settings match. Client connections below show which copies already use Hub.',
  };
}
