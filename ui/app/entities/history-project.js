import { escape, link, pill, empty } from '../shared/html.js';

const normalize = (value) => value.replace(/\\/g, '/').replace(/\/$/, '');
const contains = (parent, child) =>
  normalize(child) === normalize(parent) || normalize(child).startsWith(normalize(parent) + '/');

/** Choose a recorded representative path; this never merges identities or changes grants. */
export function projectPrimaryPath(project) {
  const locations = [...new Set(project.locations)];
  if (!locations.length) return '';
  if (project.kind === 'repository' && project.key?.startsWith('git:')) {
    const common = normalize(project.key.slice(4));
    if (common.endsWith('/.git')) {
      const root = common.slice(0, -5);
      const recorded = locations.find((location) => normalize(location) === root);
      if (recorded) return recorded;
    }
  }
  return (
    locations
      .filter((location) => contains(location, locations[0]))
      .sort((a, b) => a.length - b.length)[0] || locations[0]
  );
}

function projectCard(project, query) {
  const primary = projectPrimaryPath(project);
  const related = [...new Set(project.locations)].filter(
    (location) => normalize(location) !== normalize(primary),
  );
  const needsLocations =
    query && ![project.label, primary].join(' ').toLowerCase().includes(query.toLowerCase());
  const kind = {
    folder: 'Working folder',
    missing: 'Folder unavailable',
    unverified: 'Not verified',
  }[project.kind];
  return `<article class="card"><div class="card-b">${kind ? `<div class="project-kind">${pill(kind, project.kind === 'folder' ? '' : 'warn')}</div>` : ''}
    <h3>${escape(project.label)}</h3><p class="small-note">${project.chats} ${project.chats === 1 ? 'conversation' : 'conversations'}</p>
    <p class="minor mono project-location">${escape(primary)}</p>
    ${related.length ? `<details class="related-folders" data-ui-key="locations-${escape(project.id)}-${needsLocations ? 'matched' : 'browse'}" ${needsLocations ? 'open' : ''}><summary>Related folders (${related.length})</summary><div class="location-list">${related.map((directory) => `<p class="minor mono">${escape(directory)}</p>`).join('')}</div></details>` : ''}
    <a class="btn" href="${link('sessions', { project: project.id })}">Read chats</a>
    <details data-ui-key="project-${escape(project.id)}"><summary>Access & project settings</summary><p class="small-note">Connect clients to this project's archived conversations.</p><div class="page-actions">
    <button class="btn sm" data-history-connect="${escape(project.id)}">Connect clients…</button>
    <button class="btn sm" data-history-revoke="history-${escape(project.id.slice(0, 20))}">Revoke access…</button>
    <button class="btn sm" data-history-label="${escape(project.id)}">Rename</button>
    <button class="btn sm" data-history-exclude="${escape(project.id)}" data-excluded="${project.excluded}">${project.excluded ? 'Include again' : 'Exclude'}</button></div></details>
    </div></article>`;
}

export function savedProjectsView(projects, query = '') {
  const matches = projects.filter((project) =>
    [project.label, ...project.locations].join(' ').toLowerCase().includes(query.toLowerCase()),
  );
  if (!matches.length)
    return empty(
      query ? 'No matching projects' : 'No saved projects yet',
      query
        ? 'Try a project name or folder path.'
        : 'Capture history in Chats to save project associations.',
    );
  const repositories = matches.filter((project) => project.kind === 'repository');
  const folders = matches.filter((project) => project.kind === 'folder');
  const unavailable = matches.filter((project) => !['repository', 'folder'].includes(project.kind));
  const cards = (items) =>
    items.length
      ? `<div class="grid section-gap">${items.map((project) => projectCard(project, query)).join('')}</div>`
      : '';
  return `<section class="saved-projects"><p class="small-note">${repositories.length} ${repositories.length === 1 ? 'project' : 'projects'}</p>${cards(repositories)}
    ${folders.length ? `<details class="project-group section-gap" data-ui-key="working-folders-${query ? 'search' : 'browse'}" ${query || !repositories.length ? 'open' : ''}><summary>Other working folders (${folders.length})</summary><p class="small-note">Chat locations outside a verified Git repository.</p>${cards(folders)}</details>` : ''}
    ${unavailable.length ? `<details class="project-group section-gap" data-ui-key="unavailable-folders-${query ? 'search' : 'browse'}" ${query ? 'open' : ''}><summary>Unavailable or unverified locations (${unavailable.length})</summary><p class="small-note">Historical locations stay available here. A missing folder does not prove which project it belonged to.</p>${cards(unavailable)}</details>` : ''}</section>`;
}
