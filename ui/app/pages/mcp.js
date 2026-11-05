import { escape, link, pill, empty, intro } from '../shared/html.js';
import { resourceSources } from '../entities/resource.js';
import { mcpSetup, mcpTargets, mcpFieldLabels } from '../entities/mcp.js';
import { healthDetails } from '../entities/health.js';

function copyCard(copy, name, hasHub, canConnect) {
  const source = copy.client === 'hub';
  const status = source
    ? 'Current Hub copy'
    : copy.managed
      ? hasHub
        ? 'Uses Hub settings'
        : 'Points to a missing Hub copy'
      : copy.hubLauncher
        ? 'Hub connection needs review'
        : copy.matchesHub
          ? 'Same launch settings as Hub'
          : hasHub
            ? 'Different from Hub'
            : 'Available to add to Hub';
  const choose =
    !source && !copy.managed && !copy.hubLauncher && !copy.ambiguous && copy.matchesHub !== true;
  return `<article class="mcp-copy"><div class="row"><b>${escape(copy.label)}</b>${pill(status, copy.matchesHub === false ? 'warn' : '')}</div>
    ${copy.managed && !hasHub ? '<p class="small-note">This launcher has no original server settings. Use a working copy from another client, or restore the Hub definition from a backup.</p>' : ''}
    ${copy.hubLauncher && !copy.managed ? '<p class="small-note">This is a Hub launcher, not an original server definition. Its Hub target, installation or extra launch settings need review. Keep it separate, or preview reconnecting it to this Hub.</p>' : ''}
    ${copy.ambiguous ? '<p class="small-note">Several entries in this client use this name. Resolve the duplicate entries in the client before choosing this copy.</p>' : ''}
    ${copy.differences.length ? `<p class="small-note">${hasHub ? 'Differs from Hub' : 'Copies differ'}: ${copy.differences.map((field) => escape(mcpFieldLabels[field] || 'other settings')).join(', ')}. Private values are hidden.</p>` : ''}
    ${hasHub && canConnect && copy.matchesHub === false && !copy.ambiguous ? `<button class="btn sm" data-mcp-deliver="${escape(name)}" data-client="${escape(copy.client)}" data-replace="true">Use Hub settings in ${escape(copy.label)}</button><p class="small-note">Replaces only this server in ${escape(copy.label)} after review. Hub is kept as it is.</p>` : ''}
    ${choose ? `<button class="btn sm" data-direction="import" data-area="mcp" data-name="${escape(name)}" data-client="${escape(copy.client)}">${hasHub ? `Use ${escape(copy.label)} settings in Hub` : `Add ${escape(copy.label)} copy to Hub`}</button><p class="small-note">${hasHub ? 'Replaces only the Hub copy after review.' : 'Adds only this server to Hub after review.'} Client files are not changed.</p>` : ''}
    <details class="mcp-config" data-ui-key="mcp-copy-${escape(copy.client)}-${escape(copy.path)}"><summary>View settings</summary><pre class="code">${escape(JSON.stringify(copy.config, null, 2))}</pre><p class="minor mono">${escape(copy.path)}</p></details></article>`;
}

function clientConnections(row, state, details) {
  const server = state.servers.find((item) => item.name === row.name);
  if (!server)
    return '<p class="small-note">After saving a copy in Hub, choose which clients should use it. Nothing is delivered automatically.</p>';
  return `<section class="mcp-step"><h3>2. Choose where to use Hub settings</h3><p class="small-note">Each action reviews only this server in one client. You can keep a client’s own settings if the difference is intentional.</p>${state.status.clients
    .filter((client) => client.installed)
    .map((client) => {
      const copy = details.copies.find((item) => item.client === client.id);
      const outside = server.config.only && !server.config.only.includes(client.id);
      const disabled = state.quickClients && !state.quickClients.includes(client.id);
      const available = !outside && !disabled && !copy?.ambiguous;
      const managed = copy?.managed;
      const different = copy?.matchesHub === false;
      const message = outside
        ? 'Outside this server’s selected scope. Kept separate.'
        : disabled
          ? 'Disabled in Hub settings. Left unchanged.'
          : copy?.ambiguous
            ? 'Duplicate entries need review in the client.'
            : managed
              ? 'Already uses the Hub copy.'
              : !copy
                ? 'Not configured in this client.'
                : different
                  ? 'Different settings. Choose Hub or this client’s copy in the section above.'
                  : 'Same settings, but still an independent copy.';
      return `<div class="mcp-client"><div><b>${escape(client.label)}</b><p class="small-note">${message}</p></div>${available && !managed && !different ? `<button class="btn sm" data-mcp-deliver="${escape(row.name)}" data-client="${escape(client.id)}">${!copy ? `Add to ${escape(client.label)}` : 'Connect to Hub'}</button>` : ''}</div>`;
    })
    .join('')}</section>`;
}

/** One-server decisions stay separate from the guarded write controllers. */
export function createMcpPage({ api, render }) {
  const cache = new Map();
  let generation = 0;
  function detailsFor(name) {
    if (!cache.has(name)) {
      const current = generation;
      cache.set(name, { loading: true });
      api(`/api/mcp?${new URLSearchParams({ name })}`)
        .then((value) => {
          if (current !== generation) return;
          cache.set(name, value);
          render();
        })
        .catch((error) => {
          if (current !== generation) return;
          cache.set(name, { error: error.message });
          render();
        });
    }
    return cache.get(name);
  }
  return {
    invalidate() {
      ++generation;
      cache.clear();
    },
    view(state, query, params) {
      const all = state.status.mcp.map((row) => ({ row, setup: mcpSetup(row, state) }));
      const pending = all.filter((item) => item.setup.kind !== 'matching');
      const filtered = all
        .filter(
          ({ row, setup }) =>
            (!query ||
              [
                row.name,
                JSON.stringify(
                  state.servers.find((server) => server.name === row.name)?.config || {},
                ),
              ]
                .join(' ')
                .toLowerCase()
                .includes(query.toLowerCase())) &&
            (params.get('filter') !== 'setup' ||
              setup.kind !== 'matching' ||
              row.name === params.get('name')),
        )
        .sort(
          (a, b) =>
            (a.setup.kind === 'matching') - (b.setup.kind === 'matching') ||
            a.row.name.localeCompare(b.row.name),
        );
      const selected = filtered.find((item) => item.row.name === params.get('name')) || filtered[0];
      const columns = [
        'hub',
        ...state.status.clients.filter((client) => client.installed).map((client) => client.id),
      ];
      let detail = empty(
        'Select a server',
        'Choose a server to review its settings and client connections.',
      );
      if (selected) {
        const { row, setup } = selected;
        const data = detailsFor(row.name);
        const targets = mcpTargets(state, row.name).map((client) => client.id);
        detail = `<div class="card-h"><h2>${escape(row.name)}</h2>${pill(setup.label, setup.tone)}</div><div class="card-b"><p>${escape(setup.description)}</p>${
          data.loading
            ? empty('Reading copies…', '')
            : data.error
              ? empty(
                  'Could not compare copies',
                  data.error,
                  '<button class="btn" data-action="refresh">Try again</button>',
                )
              : `<section class="mcp-step"><h3>${row.cells.hub ? (setup.kind === 'choice' ? '1. Choose which settings to keep' : 'Hub settings') : '1. Add a working copy to Hub'}</h3><p class="small-note">${setup.kind === 'choice' || !row.cells.hub ? 'Use the settings you trust. Choosing a client copy updates Hub only; choosing Hub updates only the named client. Each choice opens a preview.' : 'Hub already has a definition. Review the client connections below to decide where it should be used.'}</p>${data.copies
                  .filter(
                    (copy) =>
                      !row.cells.hub ||
                      copy.client === 'hub' ||
                      (copy.matchesHub === false && targets.includes(copy.client)),
                  )
                  .map((copy) =>
                    copyCard(copy, row.name, !!row.cells.hub, targets.includes(copy.client)),
                  )
                  .join(
                    '',
                  )}</section>${clientConnections(row, state, data)}<details class="mcp-all-copies" data-ui-key="mcp-all-copies"><summary>Compare all copies (${data.copies.length})</summary>${data.copies.map((copy) => copyCard(copy, row.name, !!row.cells.hub, false)).join('')}</details>`
        }</div>${row.cells.hub ? `<details class="card-b" data-ui-key="mcp-health"><summary>Test the connection</summary><p class="small-note">This launches the server to check its connection. A stopped service is separate from a settings difference.</p>${healthDetails(row.name, state.doctor)}</details>` : ''}`;
      }
      return (
        intro(
          'MCP servers',
          'Share tool connections across clients. Choose settings for Hub, then review where to use them.',
          pending.length
            ? `<a class="btn" href="${link('mcp', { filter: 'setup' })}">Review ${pending.length} ${pending.length === 1 ? 'item' : 'items'}</a>`
            : '',
        ) +
        `<div class="mcp-guide"><b>What do I need to do?</b><p>Start with <strong>Settings differ</strong> or <strong>Not in Hub</strong>. Select a server and choose the copy you trust. If different settings are intentional, leave them as they are.</p><span class="small-note">Every write has a preview. Other servers and client settings are preserved.</span></div>
      <div class="mcp-filter"><a class="btn sm ${params.get('filter') !== 'setup' ? 'active' : ''}" href="${link('mcp')}">All servers (${all.length})</a><a class="btn sm ${params.get('filter') === 'setup' ? 'active' : ''}" href="${link('mcp', { filter: 'setup' })}">Needs setup (${pending.length})</a></div>
      <div class="split mcp-layout"><div class="card table-wrap">${filtered.length ? `<table class="table"><thead><tr><th>Server</th><th>Next step</th></tr></thead><tbody>${filtered.map(({ row, setup }) => `<tr class="${row === selected?.row ? 'selected' : ''}"><td><a class="row-link" href="${link('mcp', { name: row.name, ...(params.get('filter') ? { filter: params.get('filter') } : {}) })}">${escape(row.name)}</a>${resourceSources(row.cells, columns)}</td><td>${pill(setup.label, setup.tone)}</td></tr>`).join('')}</tbody></table>` : empty('Nothing to review', query ? 'Try another server name.' : 'Open All servers to see existing connections.')}</div><div class="card detail mcp-detail">${detail}</div></div>
      <details class="section-gap"><summary>Advanced: import or connect several servers</summary><div class="page-actions section-gap"><button class="btn" data-action="import">Import MCP</button><button class="btn" data-action="sync">Review delivery to clients</button></div></details>`
      );
    },
  };
}
