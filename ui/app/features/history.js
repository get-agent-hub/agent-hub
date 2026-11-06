import { savedProjectsView } from '../entities/history-project.js';
import { escape, empty, intro, link, pill } from '../shared/html.js';
import { clientLabels, readRoute } from '../shared/navigation.js';
import {
  historyConversation,
  historyViewPicker,
  chatSummary,
} from '../entities/history-conversation.js';

/** Archive pages own their query state; existing configuration and memory pages stay independent. */
export function setupHistoryUi({ api, render, notice }) {
  let status;
  let result;
  let key = '';
  let requested = '';
  let version = 0;
  let fetching = false;
  let error = '';
  let selectedSources = new Set();
  let sourcesInitialized = false;
  let pending = false;
  let lastView = 'sessions';
  const active = () => readRoute().resource === 'chats' || readRoute().page === 'projects';
  function parameters(query, params) {
    const options = {
      offset: Number(params.get('offset') || 0),
      limit: 50,
      sort: params.get('sort') === 'oldest' ? 'oldest' : 'newest',
      view: params.get('view') === 'events' ? 'events' : 'conversation',
    };
    if (params.get('project')) options.project = params.get('project');
    if (params.get('client')) options.client = params.get('client');
    if (query) {
      options.query = query;
      delete options.sort;
    }
    return options;
  }
  async function fetchView(query, params, nextKey) {
    fetching = true;
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
                view: options.view,
                ...(params.get('revision') ? { revision: params.get('revision') } : {}),
              })
            : await api(`/api/history/${query ? 'search' : 'list'}`, options);
      if (generation !== version) return;
      status = nextStatus;
      result = next;
      key = nextKey;
      error = '';
      if (!sourcesInitialized) {
        sourcesInitialized = true;
        selectedSources = new Set(
          status.background?.sources.length
            ? status.background.sources
            : status.sources
                .map((source) => source.id)
                .filter((id) => !status.excluded.includes(id)),
        );
      }
      render();
      if (lastView === 'sessions' && params.get('q') && !document.querySelector('#search').value)
        document.querySelector('#search').value = query;
    } catch (failure) {
      if (generation === version) {
        error = failure.message;
        render();
      }
    } finally {
      if (generation === version) fetching = false;
    }
  }
  function ensure(query, params, page) {
    lastView = page;
    const nextKey = `${page}|${query}|${params}`;
    if (requested !== nextKey) void fetchView(query, params, nextKey);
  }
  function sources() {
    return `<details class="card section-gap" id="history-sources" data-ui-key="history-sources" ${status.chats ? '' : 'open'}><summary class="card-h">Native history sources</summary><div class="card-b">${status.sources
      .map((source) => {
        const receipt = status.receipts.find((item) => item.source.id === source.id);
        return `<label class="tags"><input type="checkbox" data-history-source="${escape(source.id)}" ${selectedSources.has(source.id) ? 'checked' : ''} ${pending || status.background?.running ? 'disabled' : ''}>${escape(clientLabels[source.client] || source.client)} ${pill(receipt?.coverage || 'Not captured')}<span class="minor mono">${escape(source.root)}</span>${receipt ? `<span class="minor">Last checked: ${escape(new Date(receipt.checkedAt).toLocaleString())}${receipt.succeededAt ? ` · Last complete: ${escape(new Date(receipt.succeededAt).toLocaleString())}` : ''}</span>` : ''}</label>`;
      })
      .join(
        '',
      )}<p class="small-note">${status.events} stored events · ${(status.bytes / 1048576).toFixed(1)} MiB</p><p class="small-note">Capture reads all available events in the selected supported stores. Native files stay in place. History may include private messages and tool output; Hub stores it locally.</p><label><input type="checkbox" id="history-auto" ${status.background?.running ? 'checked' : ''} ${pending || !selectedSources.size ? 'disabled' : ''}> Update selected sources in the background</label><p class="small-note">Continues after you close this page and the Hub UI server. Checks every ${status.background?.interval || 30} seconds. After a computer restart, turn it on again here.</p>${backgroundNote()}<p><button class="btn primary" data-history-action="scan" ${pending || !selectedSources.size || status.job?.state === 'running' || status.background?.running ? 'disabled' : ''}>Capture selected history</button> <button class="btn" data-history-action="rebuild" ${status.background?.running ? 'disabled' : ''}>Rebuild search index</button></p></div></details>`;
  }
  function backgroundNote() {
    const background = status.background;
    if (!background) return '';
    const state = background.running
      ? background.state === 'stopping'
        ? 'Stopping after checked work…'
        : !background.responsive
          ? 'Updater is not responding. Check history status before restarting it.'
          : background.state === 'retrying'
            ? 'Waiting to retry'
            : background.state === 'capturing'
              ? 'Reading selected sources…'
              : 'Background updates are on'
      : background.enabled
        ? 'Background updates stopped. Turn them on to resume.'
        : 'Background updates are off';
    return `<p class="small-note" role="status">${state}${background.lastSuccess ? ` · Last complete update: ${escape(new Date(background.lastSuccess).toLocaleString())}` : ''}${background.error ? `<br>${escape(background.error)}` : ''}</p>`;
  }
  function progress() {
    const job = status.job;
    if (!job) return '';
    return `<details class="card section-gap" data-ui-key="history-job-${escape(job.id)}" ${job.state === 'running' || job.error ? 'open' : ''}><summary class="card-h">History update · ${escape(job.state)}</summary><div class="card-b"><b>${job.state === 'running' ? 'Capturing history…' : `Last update: ${escape(job.state)}`}</b>${job.receipts.map((receipt) => `<p>${escape(receipt.source.client)} · ${receipt.checked} files checked · ${receipt.changed} updated · ${escape(receipt.coverage)}</p>`).join('')}${job.error ? `<p>${escape(job.error)}</p>` : ''}${job.state === 'running' ? '<button class="btn" data-history-action="cancel">Stop after the current checked work</button>' : ''}</div></details>`;
  }
  function pager(params, next, query = '', previous) {
    const base = { ...Object.fromEntries(params), ...(query ? { q: query } : {}) };
    return `<div class="tags section-gap"><a class="btn" href="${link('sessions', { ...base, offset: previous ?? Math.max(0, Number(params.get('offset') || 0) - 50) })}">Previous</a>${next !== null ? `<a class="btn" href="${link('sessions', { ...base, offset: next })}">Next</a>` : '<span class="muted">End of results</span>'}</div>`;
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
    if (params.get('chat') && result?.chat)
      return historyConversation({ result, status, params, pager });
    const filters = `<div class="tags"><select class="input" id="history-project"><option value="">All projects</option>${status.projects.map((project) => `<option value="${project.id}" ${params.get('project') === project.id ? 'selected' : ''}>${escape(project.label)} · ${project.chats}</option>`).join('')}</select><select class="input" id="history-client"><option value="">All clients</option>${['claude-code', 'codex', 'dsh'].map((client) => `<option value="${client}" ${params.get('client') === client ? 'selected' : ''}>${escape(clientLabels[client] || client)}</option>`).join('')}</select>${query ? '' : `<label class="small-note">Date <select class="input" id="history-sort"><option value="newest" ${params.get('sort') !== 'oldest' ? 'selected' : ''}>Newest first</option><option value="oldest" ${params.get('sort') === 'oldest' ? 'selected' : ''}>Oldest first</option></select></label>`}</div>`;
    const rows = result?.matches
      ? result.matches.map(
          (match) =>
            `<li><a class="row-link" href="${link('sessions', { chat: match.chat, offset: match.ordinal, revision: match.revision, view: params.get('view') || 'conversation' })}">${escape(match.role)} · event ${match.ordinal}</a><pre class="document-view search-snippet">${escape(match.snippet)}</pre></li>`,
        )
      : (result?.chats || []).map((chat) => chatSummary(chat, status.projects));
    return (
      intro(
        'Chats',
        `${status.chats} conversations`,
        '<button class="btn" data-history-action="sources">Manage history sources</button>',
      ) +
      (status.incomplete || status.assetsMissing
        ? `<p class="small-note">${status.incomplete} conversations have incomplete or unsupported event coverage. ${status.assetsMissing} attachment references are not locally preserved. See each chat for details.</p>`
        : '') +
      sources() +
      progress() +
      `<div class="history-toolbar">${filters}${historyViewPicker(params)}</div>` +
      `<div class="card section-gap chat-list"><ul class="list">${rows.join('') || empty('No conversations in this view', 'Capture selected native history, change filters or try another search phrase.')}</ul></div>` +
      pager(params, result?.next ?? null, query)
    );
  }
  function projectsView(query) {
    ensure('', new URLSearchParams(), 'projects');
    if (error)
      return empty(
        'Projects could not be read',
        error,
        '<button class="btn" data-history-action="refresh">Retry</button>',
      );
    if (!status)
      return empty(
        'Reading saved projects…',
        'Working locations are found from your conversations.',
      );
    return savedProjectsView(status.projects, query);
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
    if (event.target.closest('[data-history-action="sources"]')) {
      const panel = document.querySelector('#history-sources');
      if (panel) {
        panel.open = !panel.open;
        panel.scrollIntoView({ block: 'nearest' });
      }
      return;
    }
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
      render();
    }
    if (element.id === 'history-auto') {
      pending = true;
      render();
      void api('/api/history/background', {
        enabled: element.checked,
        ...(element.checked ? { sources: [...selectedSources] } : {}),
      })
        .catch((failure) => notice(failure.message, true))
        .finally(() => {
          pending = false;
          void refresh();
        });
    }
    if (['history-project', 'history-client', 'history-sort'].includes(element.id)) {
      const params = Object.fromEntries(new URLSearchParams(location.hash.split('?')[1]));
      const field = {
        'history-project': 'project',
        'history-client': 'client',
        'history-sort': 'sort',
      }[element.id];
      params[field] = element.value;
      delete params.offset;
      location.hash = link('sessions', params);
    }
    if (element.id === 'history-view') {
      const params = new URLSearchParams(location.hash.split('?')[1]);
      params.set('view', element.value);
      params.delete('offset');
      location.hash = link('sessions', Object.fromEntries(params));
    }
    if (element.id === 'history-revision')
      location.hash = link('sessions', {
        chat: element.dataset.chat,
        revision: element.value,
        view: new URLSearchParams(location.hash.split('?')[1]).get('view') || 'conversation',
      });
  });
  document.addEventListener('input', (event) => {
    if (event.target.id !== 'search' || readRoute().resource !== 'chats') return;
    const params = new URLSearchParams(location.hash.split('?')[1]);
    params.delete('chat');
    params.delete('revision');
    if (event.target.value.trim()) params.set('q', event.target.value.trim());
    else params.delete('q');
    params.delete('offset');
    history.replaceState(null, '', link('sessions', Object.fromEntries(params)));
    requested = '';
    render();
  });
  setInterval(() => {
    if (!active() || fetching) return;
    if (status?.job?.state === 'running' || status?.background?.running) void refresh();
  }, 3000);
  return { view, projectsView, refresh };
}
