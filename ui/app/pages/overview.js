import { escape, link, pill, empty } from '../shared/html.js';
import { icon } from '../shared/navigation.js';
import { chatSummary } from '../entities/history-conversation.js';
import { copy } from '../shared/en.js';

export function overviewPage(state, archive) {
  const status = state.status;
  const records =
    (state.readiness?.memory.sharedRecords || 0) +
    (state.selection?.memoryScope === 'project' ? state.readiness?.memory.projectRecords || 0 : 0);
  const totals = [
    ['chats', 'Conversations', archive?.status?.chats, 'Preserved in your Hub'],
    ['skills', 'Skills', status.skills.length, 'Found across clients'],
    ['mcp', 'MCP servers', status.mcp.length, 'Found across clients'],
    ['memory', 'Memory records', records, 'Shared + selected project'],
  ];
  const differences = new Set(status.drift.map((d) => `${d.area}:${d.name}`)).size;
  const recent = archive?.chats || [];
  return `<section class="overview-hero">
      <div class="eyebrow">YOUR PERSONAL HUB</div>
      <h2>${copy.overviewTitle}</h2>
      <p>${copy.overviewDescription}</p>
      <div class="page-actions">
      <a class="btn primary" href="${link('sessions')}">${copy.browse} ${icon('arrow')}</a>
      <button class="btn ghost" data-quick-open>${copy.setup}</button>
      </div>
      </section>
    <div class="grid g-4 metrics">${totals
      .map(
        ([
          type,
          title,
          count,
          hint,
        ]) => `<a class="card stat" href="${link(type === 'chats' ? 'sessions' : type)}">
      <span class="k">${title} <span aria-hidden="true">↗</span>
      </span>
      <span class="v">${count === undefined ? '—' : count.toLocaleString()}</span>
      <span class="s">${hint}</span>
      </a>`,
      )
      .join('')}</div>
    <div class="overview-columns">
      <section class="card recent-chats">
      <div class="card-h">
      <div>
      <h3>${copy.recent}</h3>
      <p class="small-note">${copy.recentDescription}</p>
      </div>
      <a class="card-link" href="${link('sessions')}">View all ↗</a>
      </div>${
        recent.length
          ? `<ul class="list">${recent.map((chat) => chatSummary(chat, archive?.status?.projects || [])).join('')}</ul>`
          : empty(
              archive?.loading
                ? 'Reading saved conversations…'
                : archive?.error
                  ? 'History could not be read'
                  : 'Your conversations belong here',
              (archive?.loading ? 'Loading the local archive.' : archive?.error) ||
                'Open Chats to capture your local history and search every message.',
              `<a class="btn" href="${link('sessions')}">Open chats</a>`,
            )
      }</section>
    <section class="card hub-state">
      <div class="card-h">
      <h3>Your Hub</h3>${pill('Local', 'ok')}</div>
      <div class="card-b">
      <div class="status-line">
      <span class="dot ${differences ? 'warn' : 'ok'}">
      </span>
      <b>${differences ? `${differences} items to review` : state.readiness?.configuration === 'matched' ? 'Configurations match' : 'Review your configuration'}</b>
      </div>
      <p class="small-note">${differences ? 'Some client copies differ or are missing. Review a plan before changing files.' : 'Connection checks and configuration are tracked separately.'}</p>
      <a class="text-link" href="${link('sources')}">Review sources & setup →</a>
      <hr>
      <div class="source-stack">${status.clients
        .map(
          (client) => `<a href="${link('sources')}" class="source-line">
      <span class="client-initial" aria-hidden="true">${escape(client.label[0])}</span>
      <span>${escape(client.label)}</span>
      <span class="source-state">${client.installed ? 'Detected' : 'Not found'}</span>
      </a>`,
        )
        .join('')}</div>
      </div>
      </section>
      </div>
    <footer class="local-note">
      <span class="dot">
      </span>${copy.local}. Client files change only when you apply a reviewed plan.</footer>`;
}
