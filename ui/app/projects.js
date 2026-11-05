import { escape, intro, pill, empty } from './html.js';

const count = (value, noun) => `${value} ${noun}${value === 1 ? '' : 's'}`;
const running = (report) => report?.state === 'running';

export function projectDiscoveryView({
  clients,
  selected,
  report,
  busy = false,
  query = '',
  error = '',
  opened = [],
}) {
  const projects = (report?.projects || []).filter((project) =>
    [project.label, ...project.locations].join(' ').toLowerCase().includes(query.toLowerCase()),
  );
  const labels = Object.fromEntries(clients.map((client) => [client.id, client.label]));
  const repositories = projects.filter((project) => project.kind === 'repository');
  const folders = projects.filter((project) => project.kind !== 'repository');
  const cards = (items, title) =>
    !items.length
      ? ''
      : `<h3 class="section-title">${title}</h3><div class="grid g-3 section-gap">${items.map((project) => `<div class="card card-b discovered-project"><h3>${escape(project.label)} ${pill(project.previous ? 'Previous result' : project.kind === 'missing' ? 'Folder unavailable' : project.kind === 'unverified' ? 'Not verified' : project.kind === 'repository' ? 'Git project' : 'Working folder', project.previous || ['missing', 'unverified'].includes(project.kind) ? 'warn' : '')}</h3><p class="mono">${escape(project.locations[0])}</p><p>${count(project.chats, 'chat')} found · ${project.clients.map((id) => escape(labels[id] || id)).join(', ')}</p><details data-discovery-detail="${escape(project.id)}" ${opened.includes(project.id) ? 'open' : ''}><summary>${count(project.locationCount ?? project.locations.length, 'working folder')}</summary>${project.locations.map((location) => `<p class="mono">${escape(location)}</p>`).join('')}${(project.locationCount ?? 0) > project.locations.length ? '<p>Additional locations are retained in this scan.</p>' : ''}</details><button class="btn sm" data-discovery-reveal="${escape(project.id)}" ${project.previous || !['folder', 'repository'].includes(project.kind) ? 'disabled' : ''}>Reveal folder</button></div>`).join('')}</div>`;
  const enumerating = report?.sources?.some((source) => source.phase === 'enumerating');
  const knownTotal =
    report?.sources?.length && report.sources.every((source) => source.totalFiles !== undefined)
      ? report.sources.reduce((sum, source) => sum + source.totalFiles, 0)
      : undefined;
  const checkedAt = report?.checkedAt ? new Date(report.checkedAt).toLocaleString() : '';
  const complete = !busy && report?.coverage === 'complete' && !error;
  const files = (report?.sources || []).reduce((sum, source) => sum + source.filesRead, 0);
  const issues = report?.issues?.length
    ? report.issues
    : (report?.sources || []).flatMap((source) =>
        source.issues.length ? [`${source.label}: ${source.issues.at(-1)}`] : [],
      );
  return (
    intro(
      'Projects and folders',
      'Find working locations from your local chats. No registration is needed.',
      `<button class="btn primary" data-discover-projects ${busy || !selected.length ? 'disabled' : ''}>${busy ? 'Finding projects…' : 'Find projects'}</button>${busy || running(report) ? '<button class="btn" data-discovery-stop>Stop</button>' : ''}`,
    ) +
    `<div class="card card-b"><b>Read initial chat context from</b><div>${clients.map((client) => `<label class="checkbox"><input type="checkbox" data-discovery-client value="${escape(client.id)}" ${selected.includes(client.id) ? 'checked' : ''} ${busy || running(report) || !client.supported ? 'disabled' : ''}> ${escape(client.label)}${client.supported ? '' : ' (not supported yet)'}</label>`).join(' ')}</div><p class="small-note">Chats and client settings stay in place. Open Chats to preserve complete history and search its messages.</p></div>` +
    (error
      ? `<div class="banner"><p>${escape(error)} Previous results have not been confirmed by this attempt.</p></div>`
      : '') +
    (report
      ? `<div aria-live="polite" data-discovery-state="${report.state || (busy ? 'running' : 'complete')}" class="banner ${complete ? 'ok' : ''}"><div><b>${busy ? (enumerating ? 'Finding session files…' : 'Reading selected sources…') : report.state === 'cancelled' ? 'Scan stopped' : report.state === 'failed' ? 'Scan could not finish' : complete ? 'Initial context scan finished' : report.finished ? 'Scan finished with unresolved metadata' : 'Some metadata remains unchecked or unresolved'}</b><p>${report.total ?? report.projects.length} discovered groups · ${files}${knownTotal !== undefined ? ` of ${knownTotal}` : ''} listed files checked${busy ? ' · more may remain' : ''}. This is a discovery result, not a chat backup.</p>${checkedAt ? `<p>Last observation: ${escape(checkedAt)}</p>` : ''}${report.error ? `<p>${escape(report.error)}</p>` : ''}${(issues || []).map((issue) => `<p>${escape(issue)}</p>`).join('')}${report.previousAt ? `<p>Previous observations from ${escape(new Date(report.previousAt).toLocaleString())} stay marked until checked again.</p>` : ''}${report.previousOmitted ? '<p>Some older rows are outside the display capacity.</p>' : ''}<details data-discovery-detail="coverage" ${opened.includes('coverage') ? 'open' : ''}><summary>Sources and coverage</summary>${report.sources.map((source) => `<p><b>${escape(source.label)}</b> · ${escape(source.coverage)} · ${source.filesRead} files checked · ${source.entriesRead || 0} entries examined · ${source.unresolvedFiles || 0} unresolved · ${source.skippedFiles || 0} excluded</p>${source.directory ? `<p class="mono">${escape(source.directory)}</p>` : ''}${source.issues.map((issue) => `<p>${escape(issue)}</p>`).join('')}`).join('')}<p>Reads initial local context only. Counts are discovered chats, not complete history totals. Later context changes and child-agent logs are outside this view.</p></details></div></div>` +
        cards(repositories, 'Repository-backed projects') +
        cards(folders, 'Other working folders') +
        (!projects.length
          ? `<div class="card">${empty(query ? 'No matching locations' : busy ? 'Looking for working locations' : 'No locations confirmed by this attempt', query ? 'Try another name or folder path.' : 'Check source coverage above. Unavailable metadata is not evidence of deletion.')}</div>`
          : '') +
        `<div class="row section-gap"><button class="btn" data-discovery-page="0" ${busy || !(report.offset > 0) ? 'disabled' : ''}>First page</button><span>${report.matches ?? report.projects.length} matching groups · ${report.offset || 0}–${(report.offset || 0) + projects.length} shown</span><button class="btn" data-discovery-page="${report.nextOffset ?? 0}" ${busy || report.nextOffset === null || report.nextOffset === undefined ? 'disabled' : ''}>Next page</button></div><p class="small-note">A chat may be linked to several locations. Revealing a folder does not connect project memory. Use the existing reviewed project connection flow when you choose to connect it.</p>`
      : `<div class="card section-gap">${empty('Your working locations can appear here', 'Choose a supported client and select Find projects. Repositories and ordinary folders are kept distinct.')}</div>`)
  );
}

export function setupProjectDiscoveryUi({ api, getState, render, notice }) {
  const opened = new Set();
  function paint() {
    const active = document.activeElement;
    const attribute = [
      'data-discover-projects',
      'data-discovery-stop',
      'data-discovery-page',
      'data-discovery-reveal',
      'data-discovery-client',
    ].find((name) => active?.hasAttribute(name));
    const value = attribute ? active.getAttribute(attribute) : undefined;
    render();
    if (attribute)
      document
        .querySelector(`[${attribute}="${CSS.escape(value || '')}"]`)
        ?.focus({ preventScroll: true });
  }
  document.addEventListener(
    'toggle',
    (event) => {
      const element = event.target;
      const key = element.dataset?.discoveryDetail;
      if (!key || !element.isConnected) return;
      if (element.open) opened.add(key);
      else opened.delete(key);
      if (opened.size > 2000) opened.delete(opened.values().next().value);
    },
    true,
  );
  let selected;
  let report;
  let busy = false;
  let error = '';
  let query = '';
  let timer;
  let requestVersion = 0;
  let recovering = false;
  let starting = false;
  let stopRequested = false;
  const clients = () => getState()?.discoveryClients || [];
  const selection = () =>
    selected ??
    clients()
      .filter((client) => client.supported)
      .map((client) => client.id);
  async function page(offset = 0) {
    const version = ++requestVersion;
    try {
      const result = await api('/api/projects/discovery/status', {
        ...(report?.id ? { id: report.id } : {}),
        offset,
        query,
      });
      if (version !== requestVersion) return;
      if (result.job === null) {
        if (selected === undefined && !report) await start();
        return;
      }
      report = result;
      if (selected === undefined) selected = result.clients;
      busy = running(result);
      error = '';
      paint();
      if (busy) {
        clearTimeout(timer);
        timer = setTimeout(() => {
          void page();
        }, 300);
      }
    } catch (failure) {
      if (version !== requestVersion) return;
      busy = false;
      error = failure.message;
      paint();
    }
  }
  async function start() {
    if (busy || !selection().length) return;
    clearTimeout(timer);
    ++requestVersion;
    busy = true;
    starting = true;
    stopRequested = false;
    error = '';
    if (report)
      report = {
        ...report,
        projects: report.projects.map((project) => ({ ...project, previous: true })),
      };
    paint();
    try {
      report = await api('/api/projects/discovery/start', { clients: [...selection()].sort() });
      starting = false;
      if (stopRequested) {
        report = await api('/api/projects/discovery/cancel', { id: report.id });
        busy = false;
        paint();
      } else await page();
    } catch (failure) {
      starting = false;
      busy = false;
      error = failure.message;
      notice(error, true);
      paint();
    }
  }
  document.addEventListener('change', (event) => {
    if (!event.target.matches('[data-discovery-client]') || busy || running(report)) return;
    selected = [...document.querySelectorAll('[data-discovery-client]:checked')].map(
      (input) => input.value,
    );
    ++requestVersion;
    clearTimeout(timer);
    report = undefined;
    error = '';
    paint();
  });
  document.addEventListener('click', async (event) => {
    if (event.target.closest('[data-discover-projects]')) {
      await start();
      return;
    }
    if (event.target.closest('[data-discovery-stop]') && starting) {
      stopRequested = true;
      return;
    }
    if (event.target.closest('[data-discovery-stop]') && report?.id) {
      clearTimeout(timer);
      ++requestVersion;
      try {
        report = await api('/api/projects/discovery/cancel', { id: report.id });
        busy = false;
        paint();
      } catch (failure) {
        notice(failure.message, true);
      }
    }
    const next = event.target.closest('[data-discovery-page]');
    if (next && !busy) await page(Number(next.dataset.discoveryPage));
    const reveal = event.target.closest('[data-discovery-reveal]');
    if (reveal && report?.id) {
      try {
        await api('/api/projects/discovery/reveal', {
          id: report.id,
          projectId: reveal.dataset.discoveryReveal,
        });
      } catch (failure) {
        notice(failure.message, true);
      }
    }
  });
  return {
    initialize() {
      if (!recovering) {
        recovering = true;
        void page();
      }
    },
    refresh: start,
    view(value = '') {
      if (query !== value) {
        query = value.slice(0, 256);
        if (report?.id) {
          clearTimeout(timer);
          timer = setTimeout(() => {
            void page();
          }, 150);
        }
      }
      if (!report && !recovering) {
        recovering = true;
        void page();
      }
      return projectDiscoveryView({
        clients: clients(),
        selected: selection(),
        report,
        busy,
        query,
        error,
        opened: [...opened],
      });
    },
  };
}
