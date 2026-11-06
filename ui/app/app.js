import { setupTelemetryUi } from './features/telemetry.js';
import { escape, link, intro } from './shared/html.js';
import { resources, destinations, readRoute, icon } from './shared/navigation.js';
import { createView } from './shared/view.js';
import { copy } from './shared/en.js';
import { overviewPage } from './pages/overview.js';
import { sourcesPage } from './pages/sources.js';
import { createMcpPage } from './pages/mcp.js';
import { createResourcePages } from './pages/resources.js';
import { setupContentUi } from './features/content.js';
import { setupMemoryUi } from './features/memory.js';
import { setupQuickUi } from './features/quick.js';
import { setupProjectDiscoveryUi } from './features/projects.js';
import { setupHistoryUi } from './features/history.js';
import { setupHistoryHandoffUi } from './features/history-handoff.js';
import { setupHistoryStartupUi } from './features/history-startup.js';
import { setupImportUi } from './features/import-mcp.js';
import { setupSyncUi } from './features/sync-mcp.js';
import { setupDoctorUi } from './features/check-mcp.js';

const $ = (selector) => document.querySelector(selector);
let state;
let archive;
let archiveRequest = 0;
let query = '';
let loadVersion = 0;
const route = () => readRoute();
const paint = createView($('#content'));

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
  $('#sidebar').innerHTML =
    `<a class="brand" href="${link('overview')}" aria-label="Agent Hub overview"><span class="logo" aria-hidden="true">◇</span><span>${copy.brand}<small>${copy.tagline}</small></span></a>
    <nav class="nav" aria-label="Main navigation">${['overview', 'data', 'projects'].map((id) => `<a href="${link(id)}" class="${page === id ? 'active' : ''}" ${page === id ? 'aria-current="page"' : ''}>${icon(id)}<span>${destinations[id]}</span></a>`).join('')}</nav>
    <div class="sidebar-bottom"><a title="${copy.sources}" aria-label="${copy.sources}" class="settings-link ${page === 'sources' ? 'active' : ''}" href="${link('sources')}" ${page === 'sources' ? 'aria-current="page"' : ''}>${icon('sources')}${copy.sources}</a><div class="foot"><span><span class="dot"></span>Local workspace</span><span class="ver">v${escape(state.version ?? 'development')}</span></div></div>`;
}
function dataTabs(resource) {
  return `<nav class="data-tabs" aria-label="Data categories">${Object.entries(resources)
    .map(
      ([id, title]) =>
        `<a href="${link('data', { type: id })}" class="${resource === id ? 'active' : ''}" ${resource === id ? 'aria-current="page"' : ''}>${title}</a>`,
    )
    .join('')}</nav>`;
}
function render() {
  if (!state) return;
  const { page, resource, params } = route();
  $('#page-title').textContent = destinations[page];
  $('#search').placeholder =
    resource === 'chats'
      ? 'Search every message…'
      : page === 'projects'
        ? 'Find projects…'
        : resource
          ? `Search ${resources[resource].toLowerCase()}…`
          : 'Search skills, tools, memory…';
  $('#search').setAttribute('aria-label', $('#search').placeholder.replace('…', ''));
  $('#scope-control').hidden = !['memory', 'repos'].includes(resource);
  document.title = `${resource && resources[resource] ? resources[resource] : destinations[page]} — Agent Hub`;
  sidebar(page);
  let body;
  if (state.stateUnavailable && !['projects'].includes(page) && resource !== 'chats') {
    body = intro(
      'Settings could not be read',
      state.stateIssue,
      `<a class="btn primary" href="${link('projects')}">Find projects</a>`,
    );
  } else if (page === 'data') {
    body =
      dataTabs(resource) +
      (resource === 'chats'
        ? historyUi.view(query, params)
        : resource === 'mcp'
          ? mcpPage.view(state, query, params)
          : resourcePages.view(resource, params));
  } else if (page === 'projects') {
    body =
      resource === 'repos'
        ? `<a class="text-link" href="${link('projects')}">← All projects</a>` +
          resourcePages.view('repos', params)
        : intro(
            'Projects',
            'Your work, grouped from conversations across clients.',
            `<a class="btn" href="${link('repos')}">Current folder context</a>`,
          ) +
          historyUi.projectsView(query) +
          `<details class="project-discovery section-gap" data-ui-key="project-discovery"><summary>Find more projects & inspect source coverage</summary><div class="section-gap">${projectDiscovery.view(query)}</div></details>`;
  } else if (page === 'sources') body = sourcesPage(state);
  else if (query) body = resourcePages.view('search', params);
  else {
    void loadOverviewArchive();
    body = overviewPage(state, archive);
  }
  if (page === 'sources') body += telemetryUi.view();
  paint(body, `${page}:${resource}:${params.get('chat') || ''}:${params.get('revision') || ''}`);
}

const telemetryUi = setupTelemetryUi({ api, getState: () => state, load, notice });
const track = telemetryUi.track;
const mcpPage = createMcpPage({ api, render });
const resourcePages = createResourcePages({
  getState: () => state,
  getQuery: () => query,
  api,
  render,
  route,
});
const projectDiscovery = setupProjectDiscoveryUi({ api, getState: () => state, render, notice });
const historyUi = setupHistoryUi({ api, render, notice, track });
setupHistoryHandoffUi({ api, notice, track });
setupHistoryStartupUi({ api, notice, refresh: historyUi.refresh });
const context = { api, load, notice, getState: () => state, track };
setupQuickUi(context);
setupContentUi(context);
setupMemoryUi(context);
setupImportUi(context);
setupSyncUi(context);
setupDoctorUi(context);

async function loadOverviewArchive() {
  if (archive !== undefined) return;
  const request = ++archiveRequest;
  archive = { loading: true };
  const results = await Promise.allSettled([
    api('/api/history/status', {}),
    api('/api/history/list', { limit: 5, sort: 'newest' }),
  ]);
  if (request !== archiveRequest) return;
  archive = {
    status: results[0].status === 'fulfilled' ? results[0].value : undefined,
    chats: results[1].status === 'fulfilled' ? results[1].value.chats : [],
    error: results.find((result) => result.status === 'rejected')?.reason?.message,
  };
  render();
}

async function load() {
  const generation = ++loadVersion;
  $('#refresh').disabled = true;
  try {
    const nextState = await api('/api/state');
    if (generation !== loadVersion) return;
    state = nextState;
    telemetryUi.initialize();
    archive = undefined;
    archiveRequest++;
    projectDiscovery.initialize();
    resourcePages.invalidate();
    mcpPage.invalidate();
    const picker = $('#project-picker');
    picker.innerHTML =
      '<option value="">Shared knowledge</option><option value="@current">Folder where UI started</option>' +
      (state.projects || [])
        .map(
          (project) =>
            `<option value="${escape(project.id)}">${escape(project.id)}${project.connected === false ? ' (disconnected)' : ''}</option>`,
        )
        .join('');
    picker.value =
      state.selection?.projectId || (state.selection?.mode === 'current' ? '@current' : '');
    render();
  } catch (error) {
    if (generation !== loadVersion) return;
    if (!state)
      $('#content').innerHTML = intro(
        'Unable to read your Hub',
        error.message,
        '<button class="btn" data-action="refresh">Try again</button>',
      );
    notice(error.message, true);
  } finally {
    if (generation === loadVersion) $('#refresh').disabled = false;
  }
}
$('#project-picker').addEventListener('change', async (event) => {
  const picker = event.target;
  picker.disabled = true;
  try {
    await api('/api/project/select', { projectId: picker.value || null });
    await load();
    notice(
      'Knowledge scope changed. Previous previews expired; review a new plan before applying.',
    );
  } catch (error) {
    notice(error.message, true);
  } finally {
    picker.disabled = false;
  }
});
document.addEventListener('click', (event) => {
  if (event.target.closest('[data-skip-content]')) $('#content').focus();
  const button = event.target.closest('[data-action]');
  if (button?.dataset.action === 'refresh') void load();
  if (button?.dataset.action === 'clear-search') {
    query = '';
    $('#search').value = '';
    render();
    $('#search').focus();
  }
});
document.addEventListener('change', (event) => {
  if (event.target.id === 'skill-source')
    location.hash = link('skills', { name: event.target.dataset.name, source: event.target.value });
});
$('#search').addEventListener('input', (event) => {
  query = event.target.value.trim();
  render();
});
$('#refresh').addEventListener('click', () => {
  notice('');
  if (route().resource === 'chats') void historyUi.refresh();
  else if (route().page === 'projects') {
    void projectDiscovery.refresh();
    void historyUi.refresh();
  } else void load();
});
document.addEventListener('keydown', (event) => {
  if (
    (event.metaKey || event.ctrlKey) &&
    event.key.toLowerCase() === 'k' &&
    !document.querySelector('dialog[open]')
  ) {
    event.preventDefault();
    $('#search').focus();
    $('#search').select();
  }
});
window.addEventListener('hashchange', () => {
  // Refresh recent chats when returning from capture or deletion in another view.
  archive = undefined;
  archiveRequest++;
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
  /* Storage is optional. */
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
    /* Storage is optional. */
  }
});
void load();
