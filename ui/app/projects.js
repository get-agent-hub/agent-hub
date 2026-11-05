import { escape, intro, pill, empty } from './html.js';

const count = (value, noun) => `${value} ${noun}${value === 1 ? '' : 's'}`;

export function projectDiscoveryView({ clients, selected, report, busy = false, query = '' }) {
  const projects = (report?.projects || []).filter((project) =>
    [project.label, ...project.locations].join(' ').toLowerCase().includes(query.toLowerCase()),
  );
  const labels = Object.fromEntries(clients.map((client) => [client.id, client.label]));
  return (
    intro(
      'Projects',
      'Find projects from your local chats. No project registration is needed.',
      `<button class="btn primary" data-discover-projects ${busy || !selected.length ? 'disabled' : ''}>${busy ? 'Finding projects…' : 'Find projects'}</button>`,
    ) +
    `<div class="card card-b"><b>Read chat metadata from</b><div>${clients
      .map(
        (client) =>
          `<label class="checkbox"><input type="checkbox" data-discovery-client value="${escape(client.id)}" ${selected.includes(client.id) ? 'checked' : ''} ${busy || !client.supported ? 'disabled' : ''}> ${escape(client.label)}${client.supported ? '' : ' (not supported yet)'}</label>`,
      )
      .join(
        '',
      )}</div><p class="small-note">Your chats and client settings stay in place. Finding projects does not connect memory or enable hooks. Conversation reading and archiving come later.</p></div>` +
    (report
      ? `<div class="banner ${report.coverage === 'complete' ? 'ok' : ''}"><div><b>${report.coverage === 'complete' ? 'Project metadata checked' : 'Some metadata could not be checked'}</b><p>${count(report.projects.length, 'project')} found. This is a discovery result, not a chat backup.</p>${report.issues.map((issue) => `<p>${escape(issue)}</p>`).join('')}<details><summary>Sources and coverage</summary>${report.sources.map((source) => `<p><b>${escape(source.label)}</b> · ${escape(source.coverage)} · ${source.filesRead} file(s) checked</p>${source.issues.map((issue) => `<p>${escape(issue)}</p>`).join('')}`).join('')}<p>Only top-level local session metadata was checked, using bounded file prefixes. Child-agent logs, later context changes and complete conversation contents are outside this scan.</p></details></div></div>` +
        (projects.length
          ? `<div class="grid g-3 section-gap">${projects.map((project) => `<div class="card card-b discovered-project"><h3>${escape(project.label)} ${pill(project.kind === 'missing' ? 'Folder unavailable' : project.kind === 'unverified' ? 'Folder not verified' : project.kind === 'repository' ? 'Git project' : 'Folder', ['missing', 'unverified'].includes(project.kind) ? 'warn' : '')}</h3><p>${count(project.chats, 'chat')} found · ${project.clients.map((id) => escape(labels[id] || id)).join(', ')}</p><details><summary>${count(project.locations.length, 'working folder')}</summary>${project.locations.map((location) => `<p class="mono">${escape(location)}</p>`).join('')}</details></div>`).join('')}</div><p class="small-note">A chat can appear in more than one project. Discovery results do not change your selected memory project.</p>`
          : `<div class="card">${empty(query ? 'No matching projects' : 'No projects found', query ? 'Try another folder or project name.' : 'Check source coverage above. Missing or unsupported metadata does not mean your chats were deleted.')}</div>`)
      : `<div class="card section-gap">${empty('Your projects can appear here', 'Choose a supported client and select Find projects. Git worktrees are grouped; ordinary folders are included too.')}</div>`)
  );
}

export function setupProjectDiscoveryUi({ api, getState, render, notice }) {
  let selected;
  let report;
  let busy = false;
  const clients = () => getState()?.discoveryClients || [];
  const selection = () =>
    selected ??
    clients()
      .filter((client) => client.supported)
      .map((client) => client.id);
  document.addEventListener('change', (event) => {
    if (!event.target.matches('[data-discovery-client]') || busy) return;
    selected = [...document.querySelectorAll('[data-discovery-client]:checked')].map(
      (input) => input.value,
    );
    report = undefined;
    render();
  });
  document.addEventListener('click', async (event) => {
    if (!event.target.closest('[data-discover-projects]') || busy || !selection().length) return;
    busy = true;
    const requested = [...selection()];
    render();
    try {
      report = await api('/api/projects/discover', { clients: requested });
    } catch (error) {
      notice(error.message, true);
    } finally {
      busy = false;
      render();
    }
  });
  return {
    view: (query = '') =>
      projectDiscoveryView({ clients: clients(), selected: selection(), report, busy, query }),
  };
}
