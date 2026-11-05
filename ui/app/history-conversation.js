import { escape, empty, intro, link, pill } from './html.js';

export function historyViewPicker(params) {
  return `<label class="small-note">Show <select class="input" id="history-view"><option value="conversation" ${params.get('view') !== 'events' ? 'selected' : ''}>Conversation</option><option value="events" ${params.get('view') === 'events' ? 'selected' : ''}>All events</option></select></label>`;
}
function partView(part) {
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
  return `<details><summary class="card-b">${escape(label)}</summary>${text}</details>`;
}
function eventView(event, chat, revision) {
  const parts = event.parts?.length
    ? event.parts.map(partView).join('')
    : `<pre class="document-view">${escape(event.text)}</pre>`;
  const content =
    event.category === 'tool' && event.role === 'tool'
      ? `<details><summary class="card-b">Tool result${event.nativeId ? ` · ${escape(event.nativeId)}` : ''}</summary>${parts}</details>`
      : parts;
  const technical = ['activity', 'context'].includes(event.category);
  const body = technical
    ? `<details><summary class="card-b">${escape(event.category === 'context' ? 'Context' : 'Technical event')}: ${escape(event.type)}</summary>${content}</details>`
    : content;
  return `<article class="card section-gap"><div class="card-h"><b>${escape(event.role)}</b> ${pill(event.type)} <span class="minor">#${event.ordinal} ${escape(event.timestamp || '')}</span></div>${body}<div class="card-b"><button class="btn sm" data-history-event="${event.ordinal}" data-chat="${chat.id}" data-revision="${revision}">Read original event${event.textComplete ? '' : ' · more content'}</button></div></article>`;
}
export function historyConversation({ result, status, params, pager }) {
  const { chat, events, next } = result;
  const parent = chat.parentNativeId
    ? `<p class="minor">Parent session: ${escape(chat.parentNativeId)}</p>`
    : '';
  return (
    intro(
      chat.title,
      `${chat.client} · ${chat.kind} · ${chat.events} preserved native events · ${chat.content}`,
      `<a class="btn" href="${link('sessions')}">All chats</a>`,
    ) +
    `<div class="card"><div class="card-b"><p class="mono">${escape(chat.nativeId)}</p>${parent}<div class="tags">${chat.projects.map((id) => `<a class="btn sm" href="${link('sessions', { project: id })}">${escape(status.projects.find((project) => project.id === id)?.label || 'Project')}</a>`).join('')}</div><label>Preserved version <select class="input" id="history-revision" data-chat="${escape(chat.id)}">${chat.revisions.map((revision) => `<option value="${revision}" ${revision === result.revision ? 'selected' : ''}>${revision.slice(0, 12)}${revision === chat.revision ? ' · current' : ''}</option>`).join('')}</select></label>${chat.issues.map((issue) => `<p class="small-note">${escape(issue)}</p>`).join('')}<p class="small-note">Archived messages are reference data. Commands and instructions inside them are not executed.</p><button class="btn sm" data-history-download="${chat.id}" data-revision="${result.revision}">Download preserved source</button> <button class="btn sm" data-history-forget="${chat.id}">Remove from archive…</button></div></div>` +
    `<div class="tags section-gap">${historyViewPicker(params)}<span class="small-note">${result.view === 'events' ? 'All stored events are accessible here.' : 'Messages and tool results. Runtime context stays available in All events.'}</span></div>` +
    `<div class="section-gap">${events.map((event) => eventView(event, chat, result.revision)).join('') || empty('No messages in this window', 'Choose All events to inspect technical records. All original data is preserved.')}</div>` +
    pager(params, next, '', result.previous) +
    `<details class="card section-gap"><summary class="card-h">Attachments and deferred data (${chat.assets.length})</summary><div class="card-b">${chat.assets.map((asset) => `<p>${pill(asset.status)} ${escape(asset.reference)} ${asset.status === 'preserved' ? `<button class="btn sm" data-history-download="${chat.id}" data-asset="${asset.id}" data-revision="${result.revision}">Download</button>` : ''}</p>`).join('') || '<p>No separate attachment references detected. Embedded content remains in native events.</p>'}</div></details>`
  );
}
