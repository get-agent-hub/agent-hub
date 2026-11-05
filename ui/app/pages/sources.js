import { escape, link, pill, intro } from '../shared/html.js';
import { doctorSummary } from '../entities/health.js';

export function sourcesPage(state) {
  const r = state.status;
  const readiness = state.readiness;
  return (
    intro(
      'Sources & settings',
      'See what was found, review differences and choose what to connect.',
      '<button class="btn primary" data-quick-open>Review Hub setup</button>',
    ) +
    `<section class="grid g-3" id="clients">${r.clients
      .map(
        (c) => `<article class="card client">
      <div class="name">
      <span class="client-initial">${escape(c.label[0])}</span>${escape(c.label)}${pill(c.installed ? 'Detected' : 'Not found', c.installed ? 'ok' : '')}</div>
      <dl>
      <dt>Skills</dt>
      <dd>${r.skills.filter((s) => s.cells[c.id] && s.cells[c.id] !== 'missing').length}</dd>
      <dt>MCP servers</dt>
      <dd>${r.mcp.filter((s) => s.cells[c.id]).length}</dd>
      <dt>Differences</dt>
      <dd>${r.drift.filter((d) => d.client === c.id).length}</dd>
      <dt>Location</dt>
      <dd class="mono">${escape(c.paths.config || c.paths.profilePatch || c.paths.home)}</dd>
      </dl>
      </article>`,
      )
      .join('')}</section>
    <section class="card section-gap">
      <div class="card-h">
      <h3>Configuration</h3>${pill(readiness?.configuration?.replaceAll('-', ' ') || 'Not checked')}</div>
      <div class="card-b">
      <p>Import existing tools and skills into the Hub, then review delivery to your clients.</p>
      <div class="page-actions">
      <button class="btn" data-action="import">Import MCP</button>
      <button class="btn" data-action="sync">Deliver MCP</button>
      <button class="btn" data-content-operation="skills-import">Import skills</button>
      <button class="btn" data-content-operation="skills-sync">Deliver skills</button>
      <button class="btn" data-content-operation="context-sync">Deliver instructions & index</button>
      </div>${
        readiness?.issues?.length
          ? `<details class="section-gap" data-ui-key="readiness">
      <summary>Details to review (${readiness.issues.length})</summary>
      <ul>${readiness.issues.map((issue) => `<li>${escape(issue)}</li>`).join('')}</ul>
      </details>`
          : ''
      }</div>
      </section>
    ${
      r.drift.length
        ? `<details class="card section-gap" data-ui-key="differences">
      <summary class="card-h">Review individual differences (${r.drift.length})</summary>
      <ul class="list">${r.drift
        .slice(0, 50)
        .map(
          (d) =>
            `<li>
      <a class="recent-row" href="${link(d.area === 'skill' ? 'skills' : 'mcp', { name: d.name })}">
      <span class="copy">
      <b>${escape(d.name)}</b>
      <span class="sub">${escape(d.client)} · ${escape({ 'only-in-client': 'Not in Hub', 'only-in-hub': 'Missing in client', differs: 'Different definitions', broken: 'Broken skill link' }[d.kind] || d.kind)}</span>
      </span>
      <span>Review →</span>
      </a>
      </li>`,
        )
        .join('')}</ul>${
        r.drift.length > 50
          ? `<div class="card-b">
      <a class="text-link" href="${link('data')}">Browse all data for more differences →</a>
      </div>`
          : ''
      }</details>`
        : ''
    }
    <section class="section-gap">${doctorSummary(state.doctor)}</section>
    <details class="card section-gap" data-ui-key="memory-settings">
      <summary class="card-h">Memory, hooks & storage</summary>
      <div class="card-b">
      <dl class="definition-list">
      <dt>Hub folder</dt>
      <dd class="mono">${escape(r.hub.root)}</dd>
      <dt>Project memory</dt>
      <dd>${escape(readiness?.memory?.state?.replaceAll('-', ' ') || 'Not connected')}</dd>
      <dt>Hooks</dt>
      <dd>${escape(readiness?.memory?.hooks?.replaceAll('-', ' ') || 'Not checked')}</dd>
      </dl>${(readiness?.memory?.activity || []).map((item) => `<p class="small-note">${escape(item.client)} · Last hook: ${escape(item.hookAt || 'Not observed')} · Checkpoint: ${escape(item.checkpointAt || 'Not observed')} · Facts: ${item.submittedFacts ?? 'Unknown'}</p>`).join('')}<p>
      <button class="btn" data-memory-open>Manage memory & automation</button> <a class="btn" href="${link('repos')}">Project context</a>${readiness?.memory?.projectId ? ' <button class="btn" data-content-operation="project-disconnect">Disconnect selected project</button>' : ''}</p>
      </div>
      </details>`
  );
}
