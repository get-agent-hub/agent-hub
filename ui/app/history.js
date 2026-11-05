import { escape, empty, intro, link, pill } from './html.js';

/** Archive pages own their query state; existing configuration and memory pages stay independent. */
export function setupHistoryUi({ api, render, notice }) {
  let status;
  let result;
  let key = '';
  let requested = '';
  let version = 0;
  let error = '';
  let selectedSources = new Set();
  let automatic = false;
  let lastCapture = 0;
  let pending = false;
  let lastView = 'sessions';
  const active = () =>
    ['sessions', 'projects'].includes(location.hash.replace(/^#\/?/, '').split('?')[0]);
  function parameters(query, params) {
    const options = { offset: Number(params.get('offset') || 0), limit: 50 };
    if (params.get('project')) options.project = params.get('project');
    if (params.get('client')) options.client = params.get('client');
    if (query) options.query = query;
    return options;
  }
  async function fetchView(query, params, nextKey) {
    const generation = ++version;
    requested = nextKey;
    try {
      const nextStatus = await api('/api/history/status', {});
      const id = params.get('chat');
      const options = parameters(query, params);
      const next =
        lastView === 'projects'
          ? null
          : id
            ? await api('/api/history/read', {
                id,
                offset: options.offset,
                limit: options.limit,
                ...(params.get('revision') ? { revision: params.get('revision') } : {}),
              })
            : await api(`/api/history/${query ? 'search' : 'list'}`, options);
      if (generation !== version) return;
      status = nextStatus;
      result = next;
      key = nextKey;
      error = '';
      if (!selectedSources.size)
        selectedSources = new Set(
          status.sources.map((source) => source.id).filter((id) => !status.excluded.includes(id)),
        );
      render();
      if (lastView === 'sessions' && params.get('q') && !document.querySelector('#search').value)
        document.querySelector('#search').value = query;
    } catch (failure) {
      if (generation === version) {
        error = failure.message;
        render();
      }
    }
  }
  function ensure(query, params, page) {
    lastView = page;
    const nextKey = `${page}|${query}|${params}`;
    if (requested !== nextKey) void fetchView(query, params, nextKey);
  }
  function sources() {
    return `<details class="card section-gap" ${status.chats ? '' : 'open'}><summary class="card-h">Native history sources</summary><div class="card-b">${status.sources
      .map((source) => {
        const receipt = status.receipts.find((item) => item.source.id === source.id);
        return `<label class="tags"><input type="checkbox" data-history-source="${escape(source.id)}" ${selectedSources.has(source.id) ? 'checked' : ''}>${escape(source.client)} ${pill(receipt?.coverage || 'Not captured')}<span class="minor mono">${escape(source.root)}</span></label>`;
      })
      .join(
        '',
      )}<p class="small-note">Capture reads all available events in the selected supported stores. Native files stay in place. History may include private messages and tool output; Hub stores it locally.</p><label><input type="checkbox" id="history-auto" ${automatic ? 'checked' : ''}> Keep updated every 30 seconds while this page is open</label><p><button class="btn primary" data-history-action="scan" ${pending || status.job?.state === 'running' ? 'disabled' : ''}>Capture selected history</button> <button class="btn" data-history-action="rebuild">Rebuild search index</button></p></div></details>`;
  }
  function progress() {
    const job = status.job;
    if (!job) return '';
    return `<div class="card section-gap"><div class="card-b"><b>${job.state === 'running' ? 'Capturing history…' : `Last update: ${escape(job.state)}`}</b>${job.receipts.map((receipt) => `<p>${escape(receipt.source.client)} · ${receipt.checked} files checked · ${receipt.changed} updated · ${escape(receipt.coverage)}</p>`).join('')}${job.error ? `<p>${escape(job.error)}</p>` : ''}${job.state === 'running' ? '<button class="btn" data-history-action="cancel">Stop after the current checked work</button>' : ''}</div></div>`;
  }
  function pager(params, next, query = '') {
    const base = { ...Object.fromEntries(params), ...(query ? { q: query } : {}) };
    return `<div class="tags section-gap"><a class="btn" href="${link('sessions', { ...base, offset: Math.max(0, Number(params.get('offset') || 0) - 50) })}">Previous</a>${next !== null ? `<a class="btn" href="${link('sessions', { ...base, offset: next })}">Next</a>` : '<span class="muted">End of results</span>'}</div>`;
  }
  function conversation(params) {
    const { chat, events, next } = result;
    const parent = chat.parentNativeId
      ? `<p class="minor">Native parent: ${escape(chat.parentNativeId)}. This is lineage evidence, not a continuation command.</p>`
      : '';
    return (
      intro(
        chat.title,
        `${chat.client} · ${chat.kind} · ${chat.events} indexed native events · ${chat.content}`,
        `<a class="btn" href="${link('sessions')}">All chats</a>`,
      ) +
      `<div class="card"><div class="card-b"><p class="mono">${escape(chat.nativeId)}</p>${parent}<div class="tags">${chat.projects.map((id) => `<a class="btn sm" href="${link('sessions', { project: id })}">${escape(status.projects.find((project) => project.id === id)?.label || 'Project')}</a>`).join('')}</div><label>Preserved version <select class="input" id="history-revision" data-chat="${escape(chat.id)}">${chat.revisions.map((revision) => `<option value="${revision}" ${revision === result.revision ? 'selected' : ''}>${revision.slice(0, 12)}${revision === chat.revision ? ' · current' : ''}</option>`).join('')}</select></label>${chat.issues.map((issue) => `<p class="small-note">${escape(issue)}</p>`).join('')}<p class="small-note">Archived messages are reference data. Commands and instructions inside them are not executed.</p><button class="btn sm" data-history-download="${chat.id}" data-revision="${result.revision}">Download preserved source</button> <button class="btn sm" data-history-forget="${chat.id}">Remove from archive…</button></div></div>` +
      `<div class="section-gap">${events.map((event) => `<article class="card section-gap"><div class="card-h"><b>${escape(event.role)}</b> ${pill(event.type)} <span class="minor">#${event.ordinal} ${escape(event.timestamp || '')}</span></div><pre class="document-view">${escape(event.text)}</pre><div class="card-b"><button class="btn sm" data-history-event="${event.ordinal}" data-chat="${chat.id}" data-revision="${result.revision}">Read original event${event.textComplete ? '' : ' · more content'}</button></div></article>`).join('') || empty('No indexed events', 'Check archive coverage or download the preserved original.')}</div>` +
      pager(params, next) +
      `<details class="card section-gap"><summary class="card-h">Attachments and deferred data (${chat.assets.length})</summary><div class="card-b">${chat.assets.map((asset) => `<p>${pill(asset.status)} ${escape(asset.reference)} ${asset.status === 'preserved' ? `<button class="btn sm" data-history-download="${chat.id}" data-asset="${asset.id}" data-revision="${result.revision}">Download</button>` : ''}</p>`).join('') || '<p>No separate attachment references detected. Embedded content remains in native events.</p>'}</div></details>`
    );
  }
  function view(query, params) {
    query ||= params.get('q') || '';
    ensure(query, params, 'sessions');
    if (error)
      return empty(
        'History is unavailable',
        error,
        '<button class="btn" data-history-action="refresh">Retry</button>',
      );
    if (!status || key !== requested)
      return empty('Reading local history…', 'Native clients are not being changed.');
    if (params.get('chat') && result?.chat) return conversation(params);
    const filters = `<div class="tags"><select class="input" id="history-project"><option value="">All projects</option>${status.projects.map((project) => `<option value="${project.id}" ${params.get('project') === project.id ? 'selected' : ''}>${escape(project.label)} · ${project.chats}</option>`).join('')}</select><select class="input" id="history-client"><option value="">All clients</option>${['claude-code', 'codex', 'dsh'].map((client) => `<option ${params.get('client') === client ? 'selected' : ''}>${client}</option>`).join('')}</select></div>`;
    const rows = result?.matches
      ? result.matches.map(
          (match) =>
            `<li><a class="row-link" href="${link('sessions', { chat: match.chat, offset: match.ordinal, revision: match.revision })}">${escape(match.role)} · event ${match.ordinal}</a><pre class="document-view">${escape(match.snippet)}</pre></li>`,
        )
      : (result?.chats || []).map(
          (chat) =>
            `<li><a class="row-link" href="${link('sessions', { chat: chat.id })}">${escape(chat.title)}</a><div class="minor">${escape(chat.client)} · ${chat.kind} · ${chat.events} events · ${escape(chat.content)} · ${chat.revisions.length} version(s)</div></li>`,
        );
    return (
      intro(
        'Chats',
        `${status.chats} preserved conversations · ${status.events} events · ${(status.bytes / 1048576).toFixed(1)} MiB`,
        '<button class="btn" data-history-action="refresh">Refresh view</button>',
      ) +
      (status.incomplete || status.assetsMissing
        ? `<p class="small-note">${status.incomplete} conversations have incomplete or unsupported event coverage. ${status.assetsMissing} attachment references are not locally preserved. See each chat for details.</p>`
        : '') +
      sources() +
      progress() +
      filters +
      `<div class="card section-gap"><ul class="list">${rows.join('') || empty('No conversations in this view', 'Capture selected native history, change filters or try another search phrase.')}</ul></div>` +
      pager(params, result?.next ?? null, query)
    );
  }
  function projectsView(query) {
    ensure('', new URLSearchParams(), 'projects');
    if (!status) return '';
    const projects = status.projects.filter((project) =>
      project.label.toLowerCase().includes(query.toLowerCase()),
    );
    return `<section class="section-gap"><h2>Saved projects and conversations</h2><p class="small-note">These associations survive restarts. Finding a project does not connect its memory or grant clients access.</p><div class="grid">${projects.map((project) => `<article class="card"><div class="card-b"><h3>${escape(project.label)}</h3><p>${project.chats} preserved chats · ${escape(project.kind)}</p>${project.locations.map((directory) => `<p class="minor mono">${escape(directory)}</p>`).join('')}<a class="btn" href="${link('sessions', { project: project.id })}">Read chats</a> <button class="btn sm" data-history-connect="${project.id}">Connect clients…</button> <button class="btn sm" data-history-revoke="history-${project.id.slice(0, 20)}">Revoke access…</button> <button class="btn sm" data-history-label="${project.id}">Rename</button> <button class="btn sm" data-history-exclude="${project.id}" data-excluded="${project.excluded}">${project.excluded ? 'Include again' : 'Exclude'}</button></div></article>`).join('') || empty('No saved projects yet', 'Capture history in Chats to save project associations.')}</div></section>`;
  }
  async function refresh() {
    requested = '';
    render();
  }
  async function scan() {
    if (pending || !selectedSources.size) return;
    pending = true;
    try {
      await api('/api/history/scan', { sources: [...selectedSources] });
      lastCapture = Date.now();
      await refresh();
    } catch (failure) {
      notice(failure.message, true);
    } finally {
      pending = false;
    }
  }
  async function policy(change) {
    const plan = await api('/api/history/policy/preview', change);
    if (!window.confirm(plan.note)) return;
    await api('/api/history/policy/apply', { change: plan.change, revision: plan.revision });
    await refresh();
  }
  async function download(button) {
    const pieces = [];
    let offset = 0;
    do {
      const part = await api('/api/history/bytes', {
        id: button.dataset.historyDownload,
        revision: button.dataset.revision,
        ...(button.dataset.asset ? { asset: button.dataset.asset } : {}),
        offset,
      });
      pieces.push(Uint8Array.from(atob(part.data), (value) => value.charCodeAt(0)));
      offset = part.next;
    } while (offset !== null);
    const url = URL.createObjectURL(new Blob(pieces, { type: 'application/octet-stream' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = button.dataset.asset ? 'attachment.bin' : 'native-history.bin';
    anchor.click();
    URL.revokeObjectURL(url);
  }
  document.addEventListener('click', (event) => {
    const button = event.target.closest(
      '[data-history-action], [data-history-event], [data-history-download], [data-history-forget], [data-history-label], [data-history-exclude], [data-history-connect], [data-history-revoke]',
    );
    if (!button) return;
    void (async () => {
      const action = button.dataset.historyAction;
      if (action === 'refresh') await refresh();
      if (action === 'scan') await scan();
      if (action === 'cancel') {
        await api('/api/history/cancel', {});
        await refresh();
      }
      if (action === 'rebuild') {
        await api('/api/history/rebuild', {});
        await refresh();
      }
      if (button.dataset.historyForget) {
        await policy({ operation: 'forget', id: button.dataset.historyForget });
        location.hash = link('sessions');
      }
      if (button.dataset.historyExclude)
        await policy({
          operation: 'exclude',
          id: button.dataset.historyExclude,
          excluded: button.dataset.excluded !== 'true',
        });
      if (button.dataset.historyConnect) {
        const plan = await api('/api/history/connection/preview', {
          project: button.dataset.historyConnect,
        });
        if (plan.blocked)
          throw new Error(
            'A client has conflicting settings. Review configuration differences before connecting history.',
          );
        const paths = plan.deliveries.flatMap((delivery) =>
          delivery.files.filter((file) => file.changed).map((file) => file.path),
        );
        if (
          window.confirm(
            plan.note +
              '\n\nClients: ' +
              plan.clients.join(', ') +
              '\nFiles to update:\n' +
              paths.join('\n'),
          )
        ) {
          const result = await api('/api/history/connection/apply', {
            id: plan.id,
            revision: plan.revision,
          });
          notice(
            'History connection: ' +
              result.status +
              '. Restart clients and review their native trust prompts.',
          );
          await refresh();
        }
      }
      if (button.dataset.historyRevoke)
        await policy({ operation: 'revoke', id: button.dataset.historyRevoke });
      if (button.dataset.historyLabel) {
        const label = window.prompt('Project name');
        if (label) await policy({ operation: 'label', id: button.dataset.historyLabel, label });
      }
      if (button.dataset.historyDownload) await download(button);
      if (button.dataset.historyEvent) {
        let offset = 0;
        let text = '';
        do {
          const part = await api('/api/history/event', {
            id: button.dataset.chat,
            ordinal: Number(button.dataset.historyEvent),
            offset,
            revision: button.dataset.revision,
          });
          text += part.text;
          offset = part.next;
        } while (offset !== null);
        const container = button.closest('article');
        const pre = document.createElement('pre');
        pre.className = 'document-view';
        pre.textContent = text;
        container.append(pre);
        button.disabled = true;
      }
    })().catch((failure) => notice(failure.message, true));
  });
  document.addEventListener('change', (event) => {
    const element = event.target;
    if (element.dataset.historySource) {
      if (element.checked) selectedSources.add(element.dataset.historySource);
      else selectedSources.delete(element.dataset.historySource);
    }
    if (element.id === 'history-auto') automatic = element.checked;
    if (['history-project', 'history-client'].includes(element.id)) {
      const params = Object.fromEntries(new URLSearchParams(location.hash.split('?')[1]));
      params[element.id === 'history-project' ? 'project' : 'client'] = element.value;
      delete params.offset;
      location.hash = link('sessions', params);
    }
    if (element.id === 'history-revision')
      location.hash = link('sessions', { chat: element.dataset.chat, revision: element.value });
  });
  document.addEventListener('input', (event) => {
    if (event.target.id !== 'search' || !location.hash.startsWith('#/sessions')) return;
    const params = new URLSearchParams(location.hash.split('?')[1]);
    if (params.has('chat')) return;
    if (event.target.value.trim()) params.set('q', event.target.value.trim());
    else params.delete('q');
    params.delete('offset');
    history.replaceState(null, '', link('sessions', Object.fromEntries(params)));
    requested = '';
    render();
  });
  setInterval(() => {
    if (!active()) return;
    if (status?.job?.state === 'running') void refresh();
    else if (automatic && Date.now() - lastCapture > 30000) void scan();
  }, 1500);
  return { view, projectsView, refresh };
}
