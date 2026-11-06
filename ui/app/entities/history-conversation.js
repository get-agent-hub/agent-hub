import { escape, empty, intro, link, pill } from '../shared/html.js';
import { clientLabels } from '../shared/navigation.js';

const chatTitle = (chat) =>
  !chat.title || chat.title === `Conversation ${chat.nativeId}`
    ? 'Untitled conversation'
    : chat.title;
function chatSubtitle(chat, projects) {
  const names = chat.projects
    .map((id) => projects.find((project) => project.id === id)?.label)
    .filter(Boolean);
  return [
    clientLabels[chat.client] || chat.client,
    ...new Set(names),
    ...(chat.kind === 'subagent' ? ['Subagent'] : []),
  ].join(' · ');
}
function chatTime(value) {
  const date = typeof value === 'string' ? new Date(value) : null;
  if (!date || !Number.isFinite(date.getTime()))
    return '<span class="chat-time">Time unavailable</span>';
  const label = new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
  const detail = new Intl.DateTimeFormat(undefined, {
    dateStyle: 'full',
    timeStyle: 'long',
  }).format(date);
  return `<time class="chat-time" datetime="${escape(date.toISOString())}" title="${escape('First recorded · ' + detail)}">${escape(label)}</time>`;
}
export function chatSummary(chat, projects = []) {
  const coverage =
    chat.content !== 'complete'
      ? pill('Incomplete archive', 'warn')
      : chat.issues?.length
        ? pill('Needs review', 'warn')
        : '';
  return `<li><a class="recent-row chat-row" href="${link('sessions', { chat: chat.id })}"><span class="copy"><b>${escape(chatTitle(chat))}</b><span class="sub">${escape(chatSubtitle(chat, projects))} ${coverage}</span></span>${chatTime(chat.startedAt)}</a></li>`;
}

export function historyViewPicker(params) {
  return `<label class="small-note">Show <select class="input" id="history-view"><option value="conversation" ${params.get('view') !== 'events' ? 'selected' : ''}>Conversation</option><option value="events" ${params.get('view') === 'events' ? 'selected' : ''}>All events</option></select></label>`;
}
function partView(part, key) {
  const text = `<pre class="document-view">${escape(part.text)}</pre>`;
  if (part.kind === 'text') return text;
  if (part.kind === 'attachment') return `<p class="small-note">${escape(part.text)}</p>`;
  const label =
    part.kind === 'reasoning'
      ? 'Reasoning'
      : part.kind === 'tool-call'
        ? `Tool call: ${part.name || part.id || 'tool'}`
        : part.kind === 'tool-result'
          ? 'Tool result'
          : 'Additional content';
  return `<details data-ui-key="part-${escape(key)}"><summary class="card-b">${escape(label)}</summary>${text}</details>`;
}
function eventView(event, chat, revision) {
  const parts = event.parts?.length
    ? event.parts.map((part, index) => partView(part, `${event.ordinal}:${index}`)).join('')
    : `<pre class="document-view">${escape(event.text)}</pre>`;
  const content =
    event.category === 'tool' && event.role === 'tool'
      ? `<details data-ui-key="tool-${event.ordinal}"><summary class="card-b">Tool result${event.nativeId ? ` · ${escape(event.nativeId)}` : ''}</summary>${parts}</details>`
      : parts;
  const technical = ['activity', 'context'].includes(event.category);
  const body = technical
    ? `<details data-ui-key="event-${event.ordinal}"><summary class="card-b">${escape(event.category === 'context' ? 'Context' : 'Technical event')}: ${escape(event.type)}</summary>${content}</details>`
    : content;
  return `<article class="card message ${escape(event.role)}"><div class="card-h"><b>${escape(event.role)}</b> <span class="minor">#${event.ordinal} ${escape(event.timestamp || '')}</span></div>${body}<div class="card-b"><button class="btn sm" data-history-event="${event.ordinal}" data-chat="${chat.id}" data-revision="${revision}">Read original event${event.textComplete ? '' : ' · more content'}</button></div></article>`;
}
export function historyConversation({ result, status, params, pager }) {
  const { chat, events, next } = result;
  const parent = chat.parentNativeId
    ? `<p class="minor">Parent session: ${escape(chat.parentNativeId)}</p>`
    : '';
  return (
    intro(
      chatTitle(chat),
      chatSubtitle(chat, status.projects),
      `<button class="btn primary" data-history-handoff="${escape(chat.id)}" data-revision="${escape(result.revision)}">Continue in…</button> <a class="btn" href="${link('sessions')}">All chats</a>`,
    ) +
    `<p class="small-note">First recorded: ${chatTime(chat.startedAt)}</p>` +
    `<details class="card conversation-meta" data-ui-key="conversation-meta"><summary class="card-h">Conversation details & preserved versions</summary><div class="card-b"><p class="mono">${escape(chat.nativeId)}</p>${parent}<p class="small-note">${chat.events} stored events · ${escape(chat.content)} · ${chat.revisions.length} preserved versions</p><div class="tags">${chat.projects.map((id) => `<a class="btn sm" href="${link('sessions', { project: id })}">${escape(status.projects.find((project) => project.id === id)?.label || 'Project')}</a>`).join('')}</div><label>Preserved version <select class="input" id="history-revision" data-chat="${escape(chat.id)}">${chat.revisions.map((revision) => `<option value="${revision}" ${revision === result.revision ? 'selected' : ''}>${revision.slice(0, 12)}${revision === chat.revision ? ' · current' : ''}</option>`).join('')}</select></label>${chat.issues.map((issue) => `<p class="small-note">${escape(issue)}</p>`).join('')}<p class="small-note">Archived messages are reference data. Commands and instructions inside them are not executed.</p><button class="btn sm" data-history-download="${chat.id}" data-revision="${result.revision}">Download preserved source</button> <button class="btn sm" data-history-forget="${chat.id}">Remove from archive…</button></div></details>` +
    `<div class="tags section-gap">${historyViewPicker(params)}<span class="small-note">${result.view === 'events' ? 'All stored events are accessible here.' : 'Messages and tool results. Runtime context stays available in All events.'}</span></div>` +
    `<div class="section-gap conversation">${events.map((event) => eventView(event, chat, result.revision)).join('') || empty('No messages in this window', 'Choose All events to inspect technical records. All original data is preserved.')}</div>` +
    pager(params, next, '', result.previous) +
    `<details class="card section-gap"><summary class="card-h">Attachments and deferred data (${chat.assets.length})</summary><div class="card-b">${chat.assets.map((asset) => `<p>${pill(asset.status)} ${escape(asset.reference)} ${asset.status === 'preserved' ? `<button class="btn sm" data-history-download="${chat.id}" data-asset="${asset.id}" data-revision="${result.revision}">Download</button>` : ''}</p>`).join('') || '<p>No separate attachment references detected. Embedded content remains in native events.</p>'}</div></details>`
  );
}
