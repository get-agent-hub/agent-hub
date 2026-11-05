import { escape, link, pill, empty, intro } from '../shared/html.js';
import {
  healthDetails as renderHealthDetails,
  healthPill as renderHealthPill,
} from '../entities/health.js';
import { resourceSources, resourceComparison } from '../entities/resource.js';
import { clientLabels as labels } from '../shared/navigation.js';

export function createResourcePages({ getState, getQuery, api, render, route }) {
  const skillCache = new Map();
  let generation = 0;
  let state;
  let query;
  const columns = () => [
    'hub',
    ...state.status.clients.filter((c) => c.installed).map((c) => c.id),
  ];
  const matches = (...parts) =>
    !query || parts.join(' ').toLowerCase().includes(query.toLowerCase());
  function directionActions(area, name, clients, inHub) {
    return `<details class="card-b" data-ui-key="resolve-item"><summary>Resolve this item</summary><p class="small-note">Choose a direction, review the exact item and apply. Other entries are preserved. Clients sharing a skills directory see the same link.</p>${clients.map((client) => `<div class="tags"><span>${escape(labels[client])}</span><button class="btn sm" data-direction="import" data-area="${area}" data-name="${escape(name)}" data-client="${client}">Use this client in Hub</button>${inHub ? `<button class="btn sm" data-direction="deliver" data-area="${area}" data-name="${escape(name)}" data-client="${client}">Use Hub in this client</button>` : ''}</div>`).join('')}</details>`;
  }

  function skillsPage(params) {
    const items = state.status.skills.filter((s) => matches(s.name));
    const selected = items.find((s) => s.name === params.get('name')) || items[0];
    const cols = columns();
    let detail = empty('Select a skill', 'Choose a skill to inspect its instructions and source.');
    if (selected) {
      const sources = cols.filter((c) => selected.cells[c] && selected.cells[c] !== 'missing');
      const source = sources.includes(params.get('source')) ? params.get('source') : sources[0];
      const key = `${source}:${selected.name}`;
      if (!skillCache.has(key)) {
        const requestGeneration = generation;
        skillCache.set(key, { loading: true });
        api(`/api/skill?${new URLSearchParams({ name: selected.name, source })}`)
          .then((doc) => {
            if (requestGeneration !== generation) return;
            skillCache.set(key, doc);
            if (route().resource === 'skills') render();
          })
          .catch((error) => {
            if (requestGeneration !== generation) return;
            skillCache.set(key, { error: error.message });
            if (route().resource === 'skills') render();
          });
      }
      const doc = skillCache.get(key);
      detail = `<div class="card-h"><h2>${escape(selected.name)}</h2>${pill('SKILL.md')}</div><div class="card-b"><label>Read from<select class="input" id="skill-source" data-name="${escape(selected.name)}">${sources.map((s) => `<option value="${s}" ${s === source ? 'selected' : ''}>${labels[s]}</option>`).join('')}</select></label></div>${doc.loading ? empty('Reading skill…', '') : doc.error ? empty('Unable to read skill', doc.error, '<button class="btn" data-action="refresh">Retry</button>') : `<details class="card-b" data-ui-key="skill-path"><summary>File location</summary><dl class="section-gap"><dt>Path</dt><dd class="mono">${escape(doc.path)}</dd><dt>Resolves to</dt><dd class="mono">${escape(doc.realPath || 'Broken link')}</dd></dl></details>${doc.document.content !== null ? `<pre class="document-view">${escape(doc.document.content)}</pre>` : empty('No SKILL.md', doc.document.reason)}`}`;
    }
    if (selected)
      detail +=
        resourceComparison(selected.cells, cols, 'skills') +
        directionActions(
          'skills',
          selected.name,
          cols.filter(
            (id) => id !== 'hub' && selected.cells[id] && selected.cells[id] !== 'missing',
          ),
          !!selected.cells.hub && selected.cells.hub !== 'missing',
        );
    return (
      intro(
        'Skills',
        'Inspect shared instructions and see which clients use the same files.',
        `<button class="btn" data-content-operation="skills-import">Import skills into Hub</button><button class="btn primary" data-content-operation="skills-sync">Sync skills → clients</button>`,
      ) +
      `<div class="split"><div class="card table-wrap">${items.length ? `<table class="table"><thead><tr><th>Skill</th><th>Found in</th></tr></thead><tbody>${items.map((s) => `<tr class="${s === selected ? 'selected' : ''}"><td class="name"><a class="row-link" href="${link('skills', { name: s.name })}">${escape(s.name)}</a>${Object.values(s.cells).includes('broken') ? `<div>${pill('Broken link', 'err')}</div>` : Object.values(s.cells).includes('other-copy') ? `<div>${pill('Separate copies', 'warn')}</div>` : ''}</td><td>${resourceSources(s.cells, cols)}</td></tr>`).join('')}</tbody></table>` : empty(query ? 'No matching skills' : 'No skills found', query ? 'Try another search.' : 'Add skills to your Hub or a client to see them here.')}</div><div class="card detail">${detail}</div></div>`
    );
  }

  function mcpPage(params) {
    const items = state.status.mcp.filter((m) =>
      matches(m.name, JSON.stringify(state.servers.find((s) => s.name === m.name)?.config || {})),
    );
    const selected = items.find((s) => s.name === params.get('name')) || items[0];
    const cols = columns();
    let detail = empty('Select an MCP server', 'Choose a server to inspect its hub definition.');
    if (selected) {
      const server = state.servers.find((s) => s.name === selected.name);
      detail = `<div class="card-h"><h2>${escape(selected.name)}</h2>${server ? pill(server.config.transport, 'accent') : pill('Client only', 'warn')}</div>${server ? `<pre class="code">${escape(JSON.stringify(server.config, null, 2))}</pre><div class="card-b"><h3>Secret references</h3>${server.references.length ? `<div class="tags">${server.references.map((r) => pill(r)).join('')}</div><p class="small-note">Values are resolved from .env when the server starts.</p>` : '<span class="muted">No secret references.</span>'}</div><div class="card-b"><h3>Client scope</h3><div class="tags">${(server.config.only || ['claude-code', 'codex', 'dsh']).map((id) => pill(labels[id] || id)).join('')}</div><p class="small-note">This is the intended scope. Use Sync to review and apply the client configuration.</p></div>` : empty('Not in your hub', 'Import this definition from a client to manage it centrally.')}${server ? renderHealthDetails(selected.name, state.doctor) : ''}<div class="card-b"><button class="btn" data-action="import" data-name="${escape(selected.name)}">${server ? 'Review re-import' : 'Import this server'}</button></div>`;
    }
    if (selected)
      detail +=
        resourceComparison(selected.cells, cols, 'mcp') +
        directionActions(
          'mcp',
          selected.name,
          cols.filter((id) => id !== 'hub' && selected.cells[id]),
          state.servers.some((server) => server.name === selected.name),
        );
    return (
      intro(
        'MCP servers',
        'One registry for your tools. Inspect definitions and check their connections.',
        `<button class="btn" data-action="doctor">Check MCP</button><button class="btn" data-action="import">Import MCP</button><button class="btn primary" data-action="sync">Deliver to clients</button>`,
      ) +
      `<div class="split"><div class="card table-wrap">${items.length ? `<table class="table"><thead><tr><th>Server</th><th>Found in</th><th>Connection</th></tr></thead><tbody>${items.map((m) => `<tr class="${m === selected ? 'selected' : ''}"><td class="name"><a class="row-link" href="${link('mcp', { name: m.name })}">${escape(m.name)}</a><div class="minor">${m.inlineSecret ? pill('Inline secret', 'warn') : m.variants > 1 ? pill('Definitions differ', 'warn') : !m.cells.hub ? 'Client only' : escape(state.servers.find((s) => s.name === m.name)?.config.transport || 'In Hub')}</div></td><td>${resourceSources(m.cells, cols)}</td><td>${renderHealthPill(m.name, state.doctor)}</td></tr>`).join('')}</tbody></table>` : empty(query ? 'No matching servers' : 'No MCP servers found', query ? 'Try another search.' : 'Import client definitions to start your registry.')}</div><div class="card detail">${detail}</div></div>`
    );
  }

  function instructionsPage() {
    const doc = state.instructions;
    return (
      intro(
        'Instructions',
        'The global rules stored in your hub.',
        '<button class="btn primary" data-content-operation="context-sync">Deliver shared rules & index</button>',
      ) +
      `<div class="grid g-2-1"><div class="card"><div class="card-h"><h2 class="mono">instructions/AGENTS.md</h2></div>${doc.content !== null ? `<pre class="document-view">${escape(doc.content)}</pre>` : empty('No shared instructions yet', 'Your hub has no instructions/AGENTS.md. Add your common rules there and refresh.', '<button class="btn" data-action="refresh">Refresh</button>')}</div><div class="card"><div class="card-h"><h2>Shared rules</h2></div><div class="card-b doc"><p>The hub stores your common rules in one place. Instruction delivery is a separate step from MCP synchronization.</p><p class="muted">Review delivery to add an owned block while preserving your personal rules.</p><pre class="code">${escape(doc.path)}</pre></div></div></div>`
    );
  }

  function memoryPage(params) {
    const items = state.memory.filter((m) => matches(m.name, m.content || ''));
    const selected = items.find((m) => m.name === params.get('name')) || items[0];
    return (
      intro(
        'Memory',
        'Knowledge shared with your clients. Choose a scope above to manage its records.',
        `<button class="btn primary" data-memory-open>Manage records</button><button class="btn" data-content-operation="context-sync">Deliver shared rules & index</button>`,
      ) +
      (items.length
        ? `<h3 class="section-title">Shared index documents</h3><div class="split"><div class="card">${items.map((m) => `<a class="document-list ${m === selected ? 'active' : ''}" href="${link('memory', { name: m.name })}"><b>${escape(m.name)}</b><span>${m.content !== null ? `${m.content.length.toLocaleString()} characters` : escape(m.reason)}</span></a>`).join('')}</div><div class="card detail"><div class="card-h"><h2 class="mono">${escape(selected.name)}</h2>${pill('Read only')}</div>${selected.content !== null ? `<pre class="document-view">${escape(selected.content)}</pre>` : empty('Preview unavailable', selected.reason)}</div></div>`
        : `<div class="card">${empty(query ? 'No matching memory' : 'Your shared memory starts here', query ? 'Try another search term.' : 'Create hub/memory/MEMORY.md as your shared index, then deliver it with the common rules. Existing client-native memories stay separate.')}</div>`)
    );
  }

  function reposPage(params) {
    const repo = state.workspace;
    if (!repo)
      return (
        intro('Current folder context', 'Project context travels with your repository.') +
        `<div class="card">${empty('Open a repository', 'Run ahub ui from a repository to inspect AGENTS.md, PROJECT.md and NOW.md.')}</div>`
      );
    const selected =
      repo.files.find((f) => f.name === params.get('file')) ||
      repo.files.find((f) => f.name.endsWith('NOW.md'));
    return (
      intro(
        'Current folder context',
        'Context for the repository where you started Agent Hub.',
        `<button class="btn primary" data-project-connect ${state.status.hub.exists ? '' : 'disabled title="Set up the shared Hub first"'}>Connect project memory & handoff</button><button class="btn" data-content-operation="init-repo">Prepare handoff files only</button>`,
      ) +
      `<div class="card table-wrap"><table class="table"><thead><tr><th>Repository</th><th>Branch</th><th>AGENTS.md</th><th>PROJECT.md</th><th>NOW.md</th></tr></thead><tbody><tr><td><b>${escape(repo.name)}</b><div class="minor mono">${escape(repo.path)}</div></td><td class="mono">${escape(repo.branch)}</td>${repo.files.map((f) => `<td>${pill(f.content === null ? 'Missing' : 'Present', f.content === null ? 'warn' : 'ok')}</td>`).join('')}</tr></tbody></table></div><div class="grid g-2-1 section-gap"><div class="card"><div class="document-tabs">${repo.files.map((f) => `<a class="btn sm ${f === selected ? 'active' : ''}" href="${link('repos', { file: f.name })}">${escape(f.name.split('/').pop())}</a>`).join('')}</div>${selected.content !== null ? `<pre class="document-view">${escape(selected.content)}</pre>` : empty('Project context not created', `${selected.name} is missing. Use Prepare handoff files only to preview the missing templates.`)}</div><div class="card"><div class="card-h"><h2>Continue across agents</h2></div><div class="card-b doc"><p>Project decisions and the current task belong in this repository, alongside the code.</p><dl class="definition-list"><dt>AGENTS.md</dt><dd>Shared working rules</dd><dt>PROJECT.md</dt><dd>Architecture and decisions</dd><dt>NOW.md</dt><dd>Progress and next action</dd></dl><p class="small-note">Project connection sets up memory and handoff. Prepare handoff files only adds context templates. Agent launching remains planned.</p></div></div></div>`
    );
  }

  function searchResults() {
    const skills = state.status.skills.filter((s) => matches(s.name));
    const servers = state.status.mcp.filter((s) => matches(s.name));
    const memory = state.memory.filter((s) => matches(s.name, s.content || ''));
    const items = [
      ...skills.map((s) => ({ page: 'skills', name: s.name, kind: 'Skill' })),
      ...servers.map((s) => ({ page: 'mcp', name: s.name, kind: 'MCP server' })),
      ...memory.map((s) => ({ page: 'memory', name: s.name, kind: 'Memory' })),
    ];
    return (
      intro(
        'Search your hub',
        `${items.length} results for “${query}”`,
        '<button class="btn" data-action="clear-search">Clear search</button>',
      ) +
      `<div class="card">${items.length ? `<ul class="list">${items.map((s) => `<li>${pill(s.kind)}<a href="${link(s.page, { name: s.name })}" class="row-link">${escape(s.name)}</a><a class="card-link" href="${link(s.page, { name: s.name })}">Open →</a></li>`).join('')}</ul>` : empty('No matching items', 'Try a skill name, MCP server or a phrase from memory.')}</div>`
    );
  }

  return {
    view(resource, params) {
      state = getState();
      query = getQuery();
      return {
        skills: skillsPage,
        mcp: mcpPage,
        instructions: instructionsPage,
        memory: memoryPage,
        repos: reposPage,
        search: searchResults,
      }[resource](params);
    },
    invalidate() {
      ++generation;
      skillCache.clear();
    },
  };
}
