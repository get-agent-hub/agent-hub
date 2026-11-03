import { escape, link, pill, mark, empty, intro } from './html.js';
import { setupContentUi } from './content.js';
import { setupMemoryUi } from './memory.js';
import { setupQuickUi } from './quick.js';
import {
  doctorResultText,
  serviceDetails,
  healthDetails as renderHealthDetails,
  healthPill as renderHealthPill,
  doctorSummary as renderDoctorSummary,
} from './health.js';
const $ = (selector) => document.querySelector(selector);
const labels = { hub: 'Hub', 'claude-code': 'Claude', codex: 'Codex', dsh: 'DSH' };
const pages = {
  overview: 'Overview',
  skills: 'Skills',
  mcp: 'MCP servers',
  instructions: 'Instructions',
  memory: 'Memory',
  repos: 'Repos & tasks',
  sessions: 'Sessions',
};
const icon = (body) => `<svg viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;
const icons = {
  overview: icon(
    '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  ),
  skills: icon(
    '<path d="m12 3 2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9Z"/>',
  ),
  mcp: icon(
    '<rect x="3" y="4" width="18" height="6" rx="1.5"/><rect x="3" y="14" width="18" height="6" rx="1.5"/><path d="M7 7h.01M7 17h.01"/>',
  ),
  instructions: icon('<path d="M5 4h11l3 3v13H5zM9 10h6M9 14h6M9 18h3"/>'),
  memory: icon(
    '<path d="M9 4a3 3 0 0 0-3 3v.5A3 3 0 0 0 4 10.3 3 3 0 0 0 5 15a3 3 0 0 0 3 3.9V20M15 4a3 3 0 0 1 3 3v.5a3 3 0 0 1 2 2.8 3 3 0 0 1-1 4.7 3 3 0 0 1-3 3.9V20M12 4v16"/>',
  ),
  repos: icon(
    '<path d="M6 3v12M18 9a9 9 0 0 1-9 9"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="6" r="3"/>',
  ),
  sessions: icon('<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z"/>'),
};

let state;
let query = '';
let skillCache = new Map();
let importPlan;
let previewVersion = 0;
let applying = false;
let syncPlan;
let syncVersion = 0;
let syncApplying = false;
let doctorJob;
let doctorVersion = 0;
let doctorTimer;

function route() {
  const [name, search] = location.hash.replace(/^#\/?/, '').split('?');
  return { page: pages[name] ? name : 'overview', params: new URLSearchParams(search) };
}
function columns() {
  return ['hub', ...state.status.clients.filter((c) => c.installed).map((c) => c.id)];
}
function matches(...parts) {
  return !query || parts.join(' ').toLowerCase().includes(query.toLowerCase());
}
function notice(message, error = false) {
  $('#notice').textContent = message;
  $('#notice').classList.toggle('error', error);
  $('#notice').hidden = !message;
}
async function api(path, body) {
  const response = await fetch(
    path,
    body === undefined
      ? {}
      : {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Agent-Hub-Token': state?.token ?? '' },
          body: JSON.stringify(body),
        },
  );
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Request failed.');
  return result;
}

function sidebar(page) {
  const counts = {
    overview: state.status.drift.length,
    skills: state.status.skills.length,
    mcp: state.servers.length,
    memory: state.memory.length,
    repos: state.workspace ? 1 : 0,
  };
  $('#sidebar').innerHTML =
    `<div class="brand"><span class="logo">◆</span>agent-hub<span class="ver">v${escape(state.version ?? 'development')}</span></div>
    <div class="nav-label">Hub</div><nav class="nav">${Object.entries(pages)
      .map(
        ([id, title]) =>
          `<a href="${link(id)}" class="${page === id ? 'active' : ''}" ${page === id ? 'aria-current="page"' : ''}>${icons[id]}${title}${id === 'sessions' ? '<span class="soon">later</span>' : counts[id] !== undefined ? `<span class="count ${id === 'overview' && counts[id] ? 'warn' : ''}">${counts[id]}</span>` : ''}</a>`,
      )
      .join('')}</nav>
    <div class="nav-label">Clients</div><nav class="nav client-nav">${state.status.clients.map((c) => `<a href="${link('overview', { section: 'clients' })}"><span class="dot ${c.installed ? 'connected' : ''}"></span>${escape(c.label)}${!c.installed ? '<span class="soon">not found</span>' : ''}</a>`).join('')}</nav>
    <div class="foot"><div class="mono">${escape(state.status.hub.root.replace(/^\/Users\/[^/]+/, '~'))}</div><span>Read at ${new Date(state.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span></div>`;
}

function overview() {
  const r = state.status;
  const count = r.drift.length;
  const unique = new Set(r.drift.map((d) => `${d.area}:${d.name}`)).size;
  const rows = new Map();
  for (const d of r.drift) {
    const key = `${d.area}:${d.name}:${d.kind}`;
    if (!rows.has(key)) rows.set(key, { ...d, clients: [] });
    rows.get(key).clients.push(labels[d.client]);
  }
  const description = {
    'only-in-client': 'Not in hub',
    'only-in-hub': 'Missing in client',
    differs: 'Different definitions',
    broken: 'Broken skill link',
  };
  return (
    intro(
      'Build your Hub, then keep it in sync',
      'Collect existing MCP tools and skills, then connect your clients to one shared Hub. Project memory is an optional next step.',
      `<button class="btn primary" data-quick-open>Set up shared Hub</button><button class="btn" data-action="import">Import MCP only</button><button class="btn" data-action="sync">Sync MCP only</button>`,
    ) +
    (!r.hub.exists
      ? `<div class="banner"><div><b>Start with what you already have</b><p>Quick setup creates the Hub, collects client configuration, and connects detected clients. Preview first; no terminal setup is required.</p></div></div>`
      : `<div class="banner ${count ? '' : 'ok'}">${pill(count ? 'Needs review' : 'Up to date', count ? 'warn' : 'ok')}<div><b>${count ? `${unique} item${unique === 1 ? ' has' : 's have'} configuration differences.` : 'Hub and detected clients match.'}</b><p>${count ? `${count} comparisons across clients. Review definitions before synchronizing.` : 'Refresh after making changes in a client.'}</p></div><a class="btn sm" href="${link('mcp')}">Review MCP →</a></div>`) +
    `<div class="grid g-4 metrics"><a class="card stat" href="${link('skills')}"><div class="k">Skills</div><div class="v">${r.skills.filter((s) => s.cells.hub === 'ok').length}</div><div class="s">${r.skills.length} found across all clients</div></a><a class="card stat" href="${link('mcp')}"><div class="k">MCP servers</div><div class="v">${state.servers.length}</div><div class="s">${r.mcp.length} found across all clients</div></a><a class="card stat" href="${link('memory')}"><div class="k">Memory documents</div><div class="v">${state.memory.length}</div><div class="s">stored in your hub</div></a><a class="card stat" href="${link('overview', { section: 'clients' })}"><div class="k">Clients detected</div><div class="v">${r.clients.filter((client) => client.installed).length}</div><div class="s">review configuration below</div></a></div>` +
    `<div class="grid g-3 section-gap"><div class="card card-b"><b>1 · Collect</b><p>Bring MCP definitions and full skill bundles into your Hub. Existing Hub items stay authoritative.</p></div><div class="card card-b"><b>2 · Connect</b><p>Deliver tools, skills and shared instructions to enabled clients. Conflicts get a separate review.</p></div><div class="card card-b"><b>3 · Connect projects when needed</b><p>Optionally connect one Git project for memory and handoff. Shared Hub setup works without a project.</p></div></div>` +
    renderDoctorSummary(state.doctor) +
    `<div class="section-title" id="clients">Clients ${pill('Configuration only')}</div><div class="grid g-3">${r.clients
      .map((c) => {
        const differences = r.drift.filter((d) => d.client === c.id).length;
        return `<div class="card client"><div class="name"><span class="icon ${c.id}">${c.id === 'claude-code' ? 'C' : c.id === 'codex' ? 'X' : 'D'}</span>${escape(c.label)}${pill(c.installed ? 'Detected' : 'Not found', c.installed ? 'ok' : '')}</div><dl><dt>Skills</dt><dd>${r.skills.filter((s) => s.cells[c.id] && s.cells[c.id] !== 'missing').length} configured</dd><dt>MCP</dt><dd>${r.mcp.filter((s) => s.cells[c.id]).length} configured</dd><dt>Comparison</dt><dd>${differences ? pill(`${differences} differences`, 'warn') : pill(c.installed ? 'Matching' : 'Unavailable')}</dd><dt>Config</dt><dd class="mono">${escape((c.paths.config || c.paths.profilePatch || c.paths.home).replace(/^\/Users\/[^/]+/, '~'))}</dd></dl></div>`;
      })
      .join('')}</div>` +
    `<div class="grid g-2-1 section-gap"><div class="card"><div class="card-h"><h2>Needs attention</h2>${pill(`${unique} item${unique === 1 ? '' : 's'}`)}<a class="card-link" href="${link('mcp')}">All MCP →</a></div>${
      rows.size
        ? `<ul class="list">${[...rows.values()]
            .slice(0, 8)
            .map(
              (d) =>
                `<li><span class="mark ${d.kind === 'broken' ? 'err' : 'warn'}">${d.kind === 'broken' ? '✗' : '≠'}</span><div class="copy"><b>${escape(d.name)}</b><div class="sub">${description[d.kind]} · ${escape(d.clients.join(', '))}</div></div><a class="btn sm" href="${link(d.area === 'skill' ? 'skills' : 'mcp', { name: d.name })}">Review</a></li>`,
            )
            .join('')}</ul>`
        : empty('Nothing to review', 'Your detected client configurations match the hub.')
    }</div><div class="card"><div class="card-h"><h2>Optional project</h2><a class="card-link" href="${link('repos')}">Context →</a></div>${state.workspace ? `<div class="card-b"><b>${escape(state.workspace.name)}</b><p class="mono muted">${escape(state.workspace.branch)}</p><p class="small-note">${state.workspace.files.filter((f) => f.content !== null).length} of 3 context files present.</p><button class="btn sm" data-project-connect ${r.hub.exists ? '' : 'disabled'}>Connect project memory</button>${r.hub.exists ? '' : '<p class="small-note">Set up the shared Hub first.</p>'}</div>` : empty('No project selected — that is fine', 'Shared Hub setup works from any folder. For optional project memory, run ahub project connect /path/to/project.')}</div></div><p class="small-note">Configuration comparison and MCP connection checks are separate. Shared memory delivery is not checked here.</p>`
  );
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
      skillCache.set(key, { loading: true });
      api(`/api/skill?${new URLSearchParams({ name: selected.name, source })}`)
        .then((doc) => {
          skillCache.set(key, doc);
          if (route().page === 'skills') render();
        })
        .catch((error) => {
          skillCache.set(key, { error: error.message });
          if (route().page === 'skills') render();
        });
    }
    const doc = skillCache.get(key);
    detail = `<div class="card-h"><h2>${escape(selected.name)}</h2>${pill('SKILL.md')}</div><div class="card-b"><label>Read from<select class="input" id="skill-source" data-name="${escape(selected.name)}">${sources.map((s) => `<option value="${s}" ${s === source ? 'selected' : ''}>${labels[s]}</option>`).join('')}</select></label></div>${doc.loading ? empty('Reading skill…', '') : doc.error ? empty('Unable to read skill', doc.error, '<button class="btn" data-action="refresh">Retry</button>') : `<div class="card-b"><dl><dt>Path</dt><dd class="mono">${escape(doc.path)}</dd><dt>Resolves to</dt><dd class="mono">${escape(doc.realPath || 'Broken link')}</dd></dl></div>${doc.document.content !== null ? `<pre class="document-view">${escape(doc.document.content)}</pre>` : empty('No SKILL.md', doc.document.reason)}`}`;
  }
  return (
    intro(
      'Skills',
      'Inspect shared instructions and see which clients use the same files.',
      `<button class="btn" data-content-operation="skills-import">Import MCP only</button><button class="btn primary" data-content-operation="skills-sync">Sync skills → clients</button>`,
    ) +
    `<div class="split"><div><div class="card table-wrap">${items.length ? `<table class="table"><thead><tr><th>Skill</th>${cols.map((c) => `<th class="c">${labels[c]}</th>`).join('')}</tr></thead><tbody>${items.map((s) => `<tr class="${s === selected ? 'selected' : ''}"><td class="name"><a class="row-link" href="${link('skills', { name: s.name })}">${escape(s.name)}</a></td>${cols.map((c) => `<td class="c">${mark(s.cells[c])}</td>`).join('')}</tr>`).join('')}</tbody></table>` : empty(query ? 'No matching skills' : 'No skills found', query ? 'Try another search.' : 'Add skills to your hub or a client to see them here.')}</div><div class="legend"><span>${mark('ok')} linked</span><span>${mark('other-copy')} different location</span><span>${mark('broken')} broken</span><span>${mark('missing')} missing</span></div></div><div class="card detail">${detail}</div></div>`
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
  return (
    intro(
      'MCP servers',
      'One registry for your tools. Inspect definitions and check their connections.',
      `<button class="btn" data-action="doctor">Check MCP</button><button class="btn" data-action="import">Import MCP only</button><button class="btn primary" data-action="sync">Sync MCP only</button>`,
    ) +
    `<div class="split"><div><div class="card table-wrap">${items.length ? `<table class="table"><thead><tr><th>Server</th>${cols.map((c) => `<th class="c">${labels[c]}</th>`).join('')}<th>Connection</th><th>Review</th></tr></thead><tbody>${items.map((m) => `<tr class="${m === selected ? 'selected' : ''}"><td class="name"><a class="row-link" href="${link('mcp', { name: m.name })}">${escape(m.name)}</a><div class="minor">${escape(state.servers.find((s) => s.name === m.name)?.config.transport || 'client configuration')}</div></td>${cols.map((c) => `<td class="c">${m.cells[c] ? `<span class="mark ${m.variants > 1 ? 'warn' : 'ok'}" title="Definition ${escape(m.cells[c])}">${escape(m.cells[c])}</span>` : '<span class="mark miss" aria-label="Missing">·</span>'}</td>`).join('')}<td>${renderHealthPill(m.name, state.doctor)}</td><td>${m.inlineSecret ? pill('Inline secret', 'warn') : m.variants > 1 ? pill('Differs', 'warn') : pill('One definition')}</td></tr>`).join('')}</tbody></table>` : empty(query ? 'No matching servers' : 'No MCP servers found', query ? 'Try another search.' : 'Import client definitions to start your registry.')}</div><p class="small-note">Letters compare effective launch definitions, resolving hub references and recognizing its launcher. The same letter means an equivalent server launch. Use Check MCP to test connections and tool discovery.</p></div><div class="card detail">${detail}</div></div>`
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
      'Scoped knowledge shared between agents, with reviewed writes and recovery. Existing documents remain readable below.',
      `<button class="btn primary" data-memory-open>Manage records</button><button class="btn" data-content-operation="context-sync">Deliver shared rules & index</button>`,
    ) +
    (items.length
      ? `<div class="split"><div class="card">${items.map((m) => `<a class="document-list ${m === selected ? 'active' : ''}" href="${link('memory', { name: m.name })}"><b>${escape(m.name)}</b><span>${m.content !== null ? `${m.content.length.toLocaleString()} characters` : escape(m.reason)}</span></a>`).join('')}</div><div class="card detail"><div class="card-h"><h2 class="mono">${escape(selected.name)}</h2>${pill('Read only')}</div>${selected.content !== null ? `<pre class="document-view">${escape(selected.content)}</pre>` : empty('Preview unavailable', selected.reason)}</div></div>`
      : `<div class="card">${empty(query ? 'No matching memory' : 'Your shared memory starts here', query ? 'Try another search term.' : 'Create hub/memory/MEMORY.md as your shared index, then deliver it with the common rules. Existing client-native memories stay separate.')}</div>`)
  );
}

function reposPage(params) {
  const repo = state.workspace;
  if (!repo)
    return (
      intro('Repos & tasks', 'Project context travels with your repository.') +
      `<div class="card">${empty('Open a repository', 'Run ahub ui from a repository to inspect AGENTS.md, PROJECT.md and NOW.md.')}</div>`
    );
  const selected =
    repo.files.find((f) => f.name === params.get('file')) ||
    repo.files.find((f) => f.name.endsWith('NOW.md'));
  return (
    intro(
      'Repos & tasks',
      'Context for the repository where you started Agent Hub.',
      `<button class="btn primary" data-project-connect ${state.status.hub.exists ? '' : 'disabled title="Set up the shared Hub first"'}>Connect project memory & handoff</button><button class="btn" data-content-operation="init-repo">Prepare handoff files only</button>`,
    ) +
    `<div class="card table-wrap"><table class="table"><thead><tr><th>Repository</th><th>Branch</th><th>AGENTS.md</th><th>PROJECT.md</th><th>NOW.md</th></tr></thead><tbody><tr><td><b>${escape(repo.name)}</b><div class="minor mono">${escape(repo.path)}</div></td><td class="mono">${escape(repo.branch)}</td>${repo.files.map((f) => `<td>${pill(f.content === null ? 'Missing' : 'Present', f.content === null ? 'warn' : 'ok')}</td>`).join('')}</tr></tbody></table></div><div class="grid g-2-1 section-gap"><div class="card"><div class="document-tabs">${repo.files.map((f) => `<a class="btn sm ${f === selected ? 'active' : ''}" href="${link('repos', { file: f.name })}">${escape(f.name.split('/').pop())}</a>`).join('')}</div>${selected.content !== null ? `<pre class="document-view">${escape(selected.content)}</pre>` : empty('Project context not created', `${selected.name} is missing. Use Prepare handoff files only to preview the missing templates.`)}</div><div class="card"><div class="card-h"><h2>Continue across agents</h2></div><div class="card-b doc"><p>Project decisions and the current task belong in this repository, alongside the code.</p><dl class="definition-list"><dt>AGENTS.md</dt><dd>Shared working rules</dd><dt>PROJECT.md</dt><dd>Architecture and decisions</dd><dt>NOW.md</dt><dd>Progress and next action</dd></dl><p class="small-note">Project connection sets up memory and handoff. Prepare handoff files only adds context templates. Agent launching remains planned.</p></div></div></div>`
  );
}

function sessionsPage() {
  return (
    intro(
      'Sessions',
      'Search past conversations and carry decisions into the next agent.',
      pill('Planned'),
    ) +
    `<div class="card roadmap">${empty('Keep the thread, across agents', 'Session indexing comes after shared project context. No conversations have been indexed by Agent Hub yet.')}<ul class="list timeline"><li><span class="num">1</span><div class="copy"><b>Shared configurations</b><div class="sub">Skills and MCP, with import and drift detection.</div></div>${pill('Available', 'ok')}</li><li><span class="num">2</span><div class="copy"><b>Project context & handoff</b><div class="sub">AGENTS.md, PROJECT.md and NOW.md travel with your code.</div></div>${pill('Available', 'ok')}</li><li><span class="num">3</span><div class="copy"><b>Conversation search</b><div class="sub">An index over Claude, Codex and DSH sessions, without copying their histories.</div></div>${pill('Later')}</li></ul></div>`
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

function render() {
  if (!state) return;
  const { page, params } = route();
  $('#page-title').textContent = pages[page];
  document.title = `${pages[page]} — Agent Hub`;
  sidebar(page);
  const views = {
    overview,
    skills: skillsPage,
    mcp: mcpPage,
    instructions: instructionsPage,
    memory: memoryPage,
    repos: reposPage,
    sessions: sessionsPage,
  };
  $('#content').innerHTML =
    query && !['skills', 'mcp', 'memory'].includes(page) ? searchResults() : views[page](params);
}

setupQuickUi({ api, load, notice, getState: () => state });

async function load() {
  $('#refresh').disabled = true;
  try {
    state = await api('/api/state');
    skillCache = new Map();
    render();
  } catch (error) {
    if (!state)
      $('#content').innerHTML =
        `<div class="card">${empty('Unable to read your hub', error.message, '<button class="btn" data-action="refresh">Try again</button>')}</div>`;
    notice(error.message, true);
  } finally {
    $('#refresh').disabled = false;
  }
}

async function previewImport() {
  const version = ++previewVersion;
  importPlan = undefined;
  $('#import-apply').disabled = true;
  $('#import-preview').innerHTML = '<div class="empty">Reading client definitions…</div>';
  $('#import-summary').textContent = 'Building preview…';
  try {
    const plan = await api('/api/import/preview', {
      item: $('#import-item').value,
      prefer: $('#import-prefer').value,
      overwrite: $('#import-overwrite').checked,
    });
    if (version !== previewVersion || !$('#import-dialog').open) return;
    importPlan = plan;
    const changed = plan.servers.filter((r) => ['add', 'update'].includes(r.action)).length;
    $('#import-preview').innerHTML =
      `<div class="card table-wrap">${plan.servers.length ? `<table class="table"><thead><tr><th>Server</th><th>Action</th><th>Found in</th><th>Details</th></tr></thead><tbody>${plan.servers.map((r) => `<tr><td><b>${escape(r.name)}</b></td><td>${pill(r.action, ['add', 'update'].includes(r.action) ? 'ok' : r.action === 'skip-exists' ? '' : 'warn')}</td><td>${escape(r.from.map((c) => labels[c]).join(', ') || '—')}</td><td class="muted">${escape(r.action === 'skip-exists' ? 'Already in hub' : r.note || (r.secrets.length ? `${r.secrets.length} secret fields → .env` : 'Ready'))}</td></tr>`).join('')}</tbody></table>` : empty('No client definitions found', 'Add an MCP server in a client first.')}</div><div class="import-terms">${changed} server(s) will be written to <code>mcp/servers.yaml</code>. ${plan.envVarsToAdd.length} new secret(s) go to <code>.env</code>. Client configurations stay as they are.${plan.envVarsToAdd.length ? `<p>New variable names: ${plan.envVarsToAdd.map((v) => `<code>${escape(v)}</code>`).join(', ')}</p>` : ''}</div>`;
    $('#import-summary').textContent = changed
      ? `${changed} server(s) ready to import`
      : 'Nothing to import';
    $('#import-apply').disabled = !changed;
  } catch (error) {
    if (version !== previewVersion) return;
    $('#import-preview').innerHTML =
      `<div class="import-error">${escape(error.message)}</div><p><button class="btn" data-action="retry-preview">Retry preview</button></p>`;
    $('#import-summary').textContent = 'Preview unavailable';
  }
}

function openImport(name) {
  if (!state) return;
  $('#import-item').innerHTML =
    `<option value="mcp">All MCP servers</option>${state.status.mcp.map((s) => `<option value="${escape(`mcp:${s.name}`)}">${escape(s.name)}</option>`).join('')}`;
  $('#import-item').value = name ? `mcp:${name}` : 'mcp';
  $('#import-overwrite').checked = false;
  $('#import-dialog').showModal();
  previewImport();
}

function commandBlock(key, title, command) {
  return `<div class="command-block"><div class="card-h"><b>${escape(title)}</b><span class="spacer"></span><button class="btn sm" data-action="copy-command" data-key="${key}">Copy command</button></div><pre class="code">${escape(command)}</pre></div>`;
}

async function copySyncCommand(key) {
  const value = syncPlan?.commands?.[key];
  if (!value) return;
  try {
    await navigator.clipboard.writeText(value);
    notice('Command copied.');
  } catch {
    notice('Select and copy the command from the preview.', true);
  }
}

async function previewSync() {
  if (syncApplying) return;
  const version = ++syncVersion;
  syncPlan = undefined;
  $('#sync-apply').disabled = true;
  $('#sync-preview').innerHTML = '<div class="empty">Building a dry run…</div>';
  $('#sync-summary').textContent = 'Reading client configurations…';
  try {
    const plan = await api('/api/sync/preview', { client: $('#sync-client').value || undefined });
    if (version !== syncVersion || !$('#sync-dialog').open) return;
    syncPlan = plan;
    const changed = plan.files.filter((f) => f.changed).length;
    const tones = {
      add: 'ok',
      replace: 'accent',
      keep: '',
      remove: 'warn',
      preserve: '',
      skip: '',
      conflict: 'err',
    };
    $('#sync-preview').innerHTML =
      `${plan.blocked ? '<div class="import-error">Some definitions need review. Resolve the conflicts or choose another client.</div>' : '<p class="route-note">Dry run complete. No files written. Applying creates a private backup and checks that this plan is still current.</p>'}
      ${commandBlock('dryRun', 'Run this dry run in your terminal', plan.commands.dryRun)}
      ${!plan.blocked && changed ? commandBlock('apply', 'Apply this exact reviewed plan', plan.commands.apply) : ''}
      ${plan.files.map((f) => `<div class="card sync-file"><div class="card-h"><h3>${escape(f.label)}</h3>${pill(f.changed ? 'Will change' : 'Unchanged', f.changed ? 'accent' : '')}<span class="file-path mono">${escape(f.path)}</span></div>${f.problem ? `<div class="card-b import-error">${escape(f.problem)}</div>` : ''}<div class="table-wrap"><table class="table"><thead><tr><th>Server</th><th>Action</th><th>Details & command</th></tr></thead><tbody>${f.rows.map((r) => `<tr><td><b>${escape(r.name)}</b></td><td>${pill(r.action, tones[r.action])}</td><td><span class="muted">${escape(r.note || (r.preservedSettings?.length ? `Local settings kept: ${r.preservedSettings.join(', ')}` : r.action === 'keep' ? 'Already uses the hub launcher' : 'Launch through the hub'))}</span>${r.command && ['add', 'replace'].includes(r.action) ? `<div class="sync-row-command">${escape(r.command)}</div>` : ''}</td></tr>`).join('')}</tbody></table></div></div>`).join('')}
      <p class="small-note">MCP configuration only. Client-only entries and local tool policies are preserved. Restart affected clients after applying.</p>`;
    $('#sync-summary').textContent = plan.blocked
      ? 'Blocked by conflicts'
      : changed
        ? `${changed} client file(s) ready`
        : 'No changes needed';
    $('#sync-apply').disabled = plan.blocked || !changed;
  } catch (error) {
    if (version !== syncVersion) return;
    $('#sync-preview').innerHTML =
      `<div class="import-error">${escape(error.message)}</div><p><button class="btn" data-action="retry-sync">Retry dry run</button></p>`;
    $('#sync-summary').textContent = 'Dry run unavailable';
  }
}

function openSync() {
  if (!state) return;
  $('#sync-dialog').showModal();
  previewSync();
}

function setDoctorBusy(busy) {
  document
    .querySelectorAll('.doctor-options select, .doctor-options input')
    .forEach((el) => (el.disabled = busy));
  $('#doctor-run').disabled = busy;
  $('#doctor-cancel').hidden = !busy;
}

function renderDoctor(job) {
  const report = job.report;
  const results = report?.results || job.results || [];
  const names = $('#doctor-server').value
    ? [$('#doctor-server').value]
    : state.servers.map((s) => s.name);
  const byName = new Map(results.map((r) => [r.name, r]));
  const running = job.state === 'running';
  const rows = names.map((name) => ({ name, result: byName.get(name) }));
  const tones = { ok: 'ok', failed: 'err', skipped: '', cancelled: 'warn' };
  const checks = report?.checks.filter((c) => c.status !== 'ok') || [];
  $('#doctor-results').innerHTML =
    `${job.error ? `<div class="import-error">${escape(job.error)}</div>` : ''}<div class="card table-wrap doctor-results"><table class="table"><thead><tr><th>Server</th><th>Status</th><th>Tools</th><th>Time</th><th>Result</th></tr></thead><tbody>${rows.map(({ name, result: r }) => `<tr><td><b>${escape(name)}</b></td><td>${r ? pill(r.status, tones[r.status]) : pill(running ? 'Pending' : 'Not checked')}</td><td>${r?.tools === null || r?.tools === undefined ? '—' : r.tools}</td><td class="mono duration">${r ? `${r.durationMs} ms` : '—'}</td><td class="details">${r ? `<span>${escape(doctorResultText(r))}</span>${r.error ? `<span class="hint">${escape(r.error.hint)} · ${escape(r.phase)}</span>` : ''}${serviceDetails(r.service)}` : running ? 'Waiting for this server…' : 'Run checks to get a result.'}</td></tr>`).join('')}</tbody></table></div>${checks.length ? `<div class="section-title">Local checks</div><div class="card"><ul class="list">${checks.map((c) => `<li>${pill(c.status, c.status === 'failed' ? 'err' : 'warn')}<div class="copy"><b>${escape(c.name)}</b><div class="sub">${escape(c.message)}</div></div></li>`).join('')}</ul></div>` : ''}${report?.saveWarning ? `<p class="small-note">${escape(report.saveWarning)}</p>` : ''}`;
  $('#doctor-summary').classList.toggle('doctor-running', running);
  $('#doctor-summary').textContent = running
    ? `${results.length} of ${names.length} completed…`
    : report
      ? `${report.summary.ok} passed · ${report.summary.failed} failed · ${report.summary.skipped} skipped · ${report.summary.cancelled} cancelled · ${report.summary.warnings} warnings`
      : job.error
        ? 'Check could not finish'
        : 'Ready to check';
  $('#doctor-copy').disabled = !report?.command;
  setDoctorBusy(running);
}

async function pollDoctor(id, version) {
  if (version !== doctorVersion || !$('#doctor-dialog').open) return;
  try {
    const job = await api(`/api/doctor/${id}`);
    if (version !== doctorVersion) return;
    doctorJob = job;
    renderDoctor(job);
    if (job.state === 'running') doctorTimer = setTimeout(() => pollDoctor(id, version), 800);
    else await load();
  } catch (error) {
    if (version !== doctorVersion) return;
    $('#doctor-results').innerHTML =
      `<div class="import-error">${escape(error.message)}</div><p><button class="btn" data-action="resume-doctor">Reconnect to check</button></p>`;
    $('#doctor-summary').textContent = 'Connection to check interrupted';
  }
}

async function startDoctor() {
  if (doctorJob?.state === 'running') return;
  const timeout = Number($('#doctor-timeout').value);
  if (!Number.isFinite(timeout) || timeout < 0.1 || timeout > 120) {
    $('#doctor-summary').textContent = 'Timeout must be 0.1–120 seconds.';
    return;
  }
  const version = ++doctorVersion;
  clearTimeout(doctorTimer);
  setDoctorBusy(true);
  $('#doctor-summary').textContent = 'Starting checks…';
  try {
    const job = await api('/api/doctor/run', {
      name: $('#doctor-server').value || undefined,
      client: $('#doctor-client').value || undefined,
      timeout,
    });
    if (version !== doctorVersion) {
      await api('/api/doctor/cancel', { id: job.id });
      return;
    }
    doctorJob = job;
    renderDoctor(job);
    pollDoctor(job.id, version);
  } catch (error) {
    if (version !== doctorVersion) return;
    setDoctorBusy(false);
    $('#doctor-results').innerHTML = `<div class="import-error">${escape(error.message)}</div>`;
    $('#doctor-summary').textContent = 'Unable to start checks';
  }
}

async function cancelDoctor(close = false) {
  clearTimeout(doctorTimer);
  if (doctorJob?.state === 'running') {
    try {
      await api('/api/doctor/cancel', { id: doctorJob.id });
    } catch (error) {
      notice(error.message, true);
      if (!close) return;
    }
  }
  if (close) {
    ++doctorVersion;
    $('#doctor-dialog').close();
  } else if (doctorJob?.id) pollDoctor(doctorJob.id, doctorVersion);
}

function openDoctor(name) {
  $('#doctor-server').innerHTML =
    `<option value="">All hub servers</option>${state.servers.map((s) => `<option value="${escape(s.name)}">${escape(s.name)}</option>`).join('')}`;
  $('#doctor-server').value = name || '';
  doctorJob = undefined;
  $('#doctor-dialog').showModal();
  renderDoctor({ state: 'ready', results: [] });
  startDoctor();
}

$('#doctor-dialog').addEventListener('cancel', (event) => {
  event.preventDefault();
  cancelDoctor(true);
});

$('#sync-dialog').addEventListener('cancel', (event) => {
  if (syncApplying) event.preventDefault();
  else ++syncVersion;
});
$('#sync-apply').addEventListener('click', async () => {
  if (!syncPlan || syncPlan.blocked || syncApplying) return;
  syncApplying = true;
  $('#sync-apply').disabled = true;
  $('#sync-client').disabled = true;
  $('#sync-apply').textContent = 'Applying…';
  try {
    const result = await api('/api/sync/apply', { id: syncPlan.id });
    $('#sync-preview').innerHTML =
      `<div class="banner ok"><div><b>Synced ${result.changedFiles} client file(s).</b><p>Restart the affected clients to load the new MCP configuration.</p></div></div>${result.backup ? `<p class="small-note">Backup: ${escape(result.backup)}</p>` : ''}${result.restoreCommand ? commandBlock('restore', 'Preview rollback in your terminal', result.restoreCommand) : ''}`;
    syncPlan.commands = { restore: result.restoreCommand };
    $('#sync-summary').textContent = 'Sync completed';
    notice(`Synced ${result.changedFiles} client file(s). Restart affected clients.`);
    await load();
  } catch (error) {
    syncPlan = undefined;
    $('#sync-preview').innerHTML =
      `<div class="import-error">${escape(error.message)}</div><p><button class="btn" data-action="retry-sync">Review a new dry run</button></p>`;
    $('#sync-summary').textContent = 'Sync not completed';
  } finally {
    syncApplying = false;
    $('#sync-client').disabled = false;
    $('#sync-apply').textContent = 'Apply with backup';
  }
});

document.addEventListener('click', (event) => {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const action = button.dataset.action;
  if (action === 'refresh') load();
  if (action === 'import') openImport(button.dataset.name);
  if (action === 'sync') openSync();
  if (action === 'doctor') openDoctor(button.dataset.name);
  if (action === 'run-doctor') startDoctor();
  if (action === 'cancel-doctor') cancelDoctor();
  if (action === 'close-doctor') cancelDoctor(true);
  if (action === 'resume-doctor' && doctorJob?.id) pollDoctor(doctorJob.id, doctorVersion);
  if (action === 'copy-doctor-command' && doctorJob?.report?.command)
    navigator.clipboard
      .writeText(doctorJob.report.command)
      .then(() => notice('Check command copied.'))
      .catch(() => notice('Unable to access clipboard.', true));
  if (action === 'close-sync' && !syncApplying) {
    ++syncVersion;
    $('#sync-dialog').close();
  }
  if (action === 'retry-sync' && !syncApplying) previewSync();
  if (action === 'copy-command') copySyncCommand(button.dataset.key);
  if (action === 'close-import' && !applying) {
    ++previewVersion;
    $('#import-dialog').close();
  }
  if (action === 'retry-preview') previewImport();
  if (action === 'clear-search') {
    query = '';
    $('#search').value = '';
    render();
    $('#search').focus();
  }
});
document.addEventListener('change', (event) => {
  if (event.target.id === 'sync-client') previewSync();
  if (event.target.id === 'skill-source')
    location.hash = link('skills', { name: event.target.dataset.name, source: event.target.value });
  if (['import-item', 'import-prefer', 'import-overwrite'].includes(event.target.id))
    previewImport();
});
$('#import-dialog').addEventListener('cancel', (event) => {
  if (applying) event.preventDefault();
  else ++previewVersion;
});
$('#import-apply').addEventListener('click', async () => {
  if (!importPlan || applying) return;
  applying = true;
  $('#import-apply').disabled = true;
  $('#import-apply').textContent = 'Importing…';
  document
    .querySelectorAll('.import-options input, .import-options select')
    .forEach((el) => (el.disabled = true));
  try {
    const result = await api('/api/import/apply', { id: importPlan.id });
    $('#import-dialog').close();
    notice(
      `Imported ${result.imported} server(s) into your hub.${result.commit ? ` Commit ${result.commit}.` : ''}`,
    );
    await load();
  } catch (error) {
    importPlan = undefined;
    $('#import-preview').innerHTML =
      `<div class="import-error">${escape(error.message)}</div><p><button class="btn" data-action="retry-preview">Review a new preview</button></p>`;
    $('#import-summary').textContent = 'Import not completed';
  } finally {
    applying = false;
    $('#import-apply').textContent = 'Import into hub';
    document
      .querySelectorAll('.import-options input, .import-options select')
      .forEach((el) => (el.disabled = false));
  }
});
$('#search').addEventListener('input', (event) => {
  query = event.target.value.trim();
  render();
});
$('#refresh').addEventListener('click', () => {
  notice('');
  load();
});
document.addEventListener('keydown', (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    $('#search').focus();
    $('#search').select();
  }
});
window.addEventListener('hashchange', () => {
  query = '';
  $('#search').value = '';
  render();
  if (route().params.get('section') === 'clients') $('#clients')?.scrollIntoView();
  else window.scrollTo(0, 0);
});
try {
  const theme = localStorage.getItem('agent-hub-theme');
  if (['dark', 'light'].includes(theme)) document.documentElement.dataset.theme = theme;
} catch {
  /* storage optional */
}
$('#theme').addEventListener('click', () => {
  const current =
    document.documentElement.dataset.theme ||
    (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  const theme = current === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem('agent-hub-theme', theme);
  } catch {
    /* storage optional */
  }
});
setupContentUi({ api, load, notice });
setupMemoryUi({ api, load, notice });
load();
