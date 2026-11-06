import { escape, pill } from '../shared/html.js';
import { clientLabels } from '../shared/navigation.js';

const number = (value) => Number(value || 0).toLocaleString();
function time(value) {
  const date = value ? new Date(value) : null;
  if (!date || !Number.isFinite(date.getTime())) return 'Not recorded';
  return `<time datetime="${escape(date.toISOString())}" title="${escape(date.toLocaleString())}">${escape(new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date))}</time>`;
}
function storage(bytes = 0) {
  const units = ['B', 'KiB', 'MiB', 'GiB'];
  const unit = bytes > 0 ? Math.min(3, Math.floor(Math.log(bytes) / Math.log(1024))) : 0;
  return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: unit ? 1 : 0 }).format(bytes / 1024 ** unit)} ${units[unit]}`;
}
function updateState(status) {
  const background = status.background;
  if (background?.running) {
    if (background.state === 'stopping')
      return [
        'Finishing current update',
        'Updates will stop after checked work is saved.',
        'accent',
      ];
    if (!background.responsive)
      return [
        'Updater needs attention',
        'The updater has not reported recently. Check its status before restarting.',
        'warn',
      ];
    if (background.state === 'retrying')
      return [
        'Waiting to retry',
        background.error || 'A source could not be read. Saved chats are retained.',
        'warn',
      ];
    return [
      background.state === 'capturing' ? 'Updating archive' : 'Automatic updates on',
      `Checks selected sources every ${background.interval || 30} seconds, even when this page is closed.`,
      'ok',
    ];
  }
  if (status.job?.state === 'running')
    return [
      'Saving chats…',
      'Completed conversations are kept as the update progresses.',
      'accent',
    ];
  if (background?.enabled)
    return [
      'Automatic updates stopped',
      'Turn them on below to resume your saved selection.',
      'warn',
    ];
  return ['Manual updates', 'Choose sources below, then save or update your archive.', ''];
}
function coverage(status) {
  const items = [];
  if (status.incomplete)
    items.push(
      `<details data-ui-key="archive-incomplete"><summary>${number(status.incomplete)} ${status.incomplete === 1 ? 'conversation needs' : 'conversations need'} review</summary><p>Some conversation data is incomplete or uses an unsupported format. Open a flagged chat to inspect its coverage.</p></details>`,
    );
  if (status.assetsMissing)
    items.push(
      `<details data-ui-key="archive-attachments"><summary>${number(status.assetsMissing)} attachment references are not stored locally</summary><p>This includes remote links, files outside the selected folders and unavailable files. It does not count missing messages. Open a chat’s details to inspect its attachments.</p></details>`,
    );
  return items.length ? `<div class="archive-coverage">${items.join('')}</div>` : '';
}
function sourceCard(source, status, selectedSources, pending) {
  const receipt = status.receipts.find((item) => item.source.id === source.id);
  const excluded = status.excluded.includes(source.id);
  const [label, tone] = excluded
    ? ['Excluded', '']
    : {
        complete: ['Read successfully', 'ok'],
        partial: ['Needs another read', 'warn'],
        'not-found': ['Folder not found', 'warn'],
        unavailable: ['Could not read', 'warn'],
      }[receipt?.coverage] || ['Not saved yet', ''];
  const latest =
    receipt?.coverage === 'complete'
      ? receipt.succeededAt || receipt.checkedAt
      : receipt?.checkedAt;
  return `<article class="archive-source"><div class="archive-source-head"><label><input type="checkbox" data-history-source="${escape(source.id)}" ${selectedSources.has(source.id) ? 'checked' : ''} ${pending || status.background?.running ? 'disabled' : ''}><strong>${escape(clientLabels[source.client] || source.client)}</strong></label>${pill(label, tone)}</div><p class="archive-source-time">${latest ? `${receipt.coverage === 'complete' ? 'Last read' : 'Last attempt'} · ${time(latest)}` : 'Choose this source to save its chats.'}</p><details data-ui-key="history-source-${escape(source.id)}"><summary>Folder & read details</summary><div class="archive-source-detail"><code>${escape(source.root)}</code>${receipt ? `<p>Last checked · ${time(receipt.checkedAt)}</p>${receipt.succeededAt ? `<p>Last complete read · ${time(receipt.succeededAt)}</p>` : ''}` : ''}${(receipt?.issues || []).map((issue) => `<p>${escape(issue)}</p>`).join('')}</div></details></article>`;
}

/** Archive presentation only; actions and persisted selection remain in the history feature. */
export function historySourcesPanel({ status, selectedSources, pending }) {
  const [state, description, tone] = updateState(status);
  const busy = pending || status.job?.state === 'running' || status.background?.running;
  const startupIssue = ['needs-review', 'hub-changed'].includes(status.startup?.state);
  const loginDescription = startupIssue
    ? 'Startup needs review. Existing startup files are preserved.'
    : !status.startup?.supported
      ? 'Available on macOS and Linux with systemd user sessions.'
      : status.startup?.installed
        ? status.background?.enabled
          ? 'Configured for your next sign-in. Your saved source selection will be used.'
          : 'Configured, but automatic updates are paused. Turn them on to resume at sign-in.'
        : 'Optional. Review the startup files before applying; takes effect at the next sign-in.';
  return `<section class="card archive-panel section-gap" aria-label="Local chat archive"><div class="archive-overview"><div class="archive-heading"><div><h3>Your local archive</h3><p>Saved in Hub. Originals stay in your clients.</p></div><span class="pill archive-state ${tone}" role="status"><span class="dot" aria-hidden="true"></span>${escape(state)}</span></div><dl class="archive-stats"><div><dt>Conversations</dt><dd>${number(status.chats)}</dd></div><div><dt>Saved events</dt><dd title="Includes messages, tool activity and technical events">${number(status.events)}</dd></div><div><dt>Captured data</dt><dd title="Source bytes in current saved versions; disk use also depends on revisions and attachments">${storage(status.bytes)}</dd></div></dl><p class="archive-update-note">${escape(description)}${status.background?.lastSuccess ? ` <span>Last full update · ${time(status.background.lastSuccess)}</span>` : ''}</p>${coverage(status)}</div><details id="history-sources" class="archive-settings" data-ui-key="history-sources" ${status.chats ? '' : 'open'}><summary><span>Sources & automatic updates</span><span class="archive-source-count">${number(status.sources.length)} sources</span></summary><div class="archive-settings-body"><div class="archive-source-grid">${status.sources.map((source) => sourceCard(source, status, selectedSources, pending)).join('')}</div><p class="archive-selection-note">${status.background?.running ? 'Pause automatic updates to change selected sources.' : selectedSources.size ? `${number(selectedSources.size)} sources selected. Only selected folders are read.` : 'Select at least one source to save chats.'}</p><div class="archive-toggles"><label class="archive-toggle"><span><strong>Update selected sources in the background</strong><small>Keep the archive current after closing Hub. Checks every ${status.background?.interval || 30} seconds.</small></span><input type="checkbox" role="switch" id="history-auto" ${status.background?.running ? 'checked' : ''} ${pending || !selectedSources.size ? 'disabled' : ''}></label><label class="archive-toggle"><span><strong>Resume selected updates when I sign in</strong><small ${startupIssue ? 'class="archive-setting-issue"' : ''}>${escape(loginDescription)}</small></span><input type="checkbox" role="switch" id="history-login" ${status.startup?.installed ? 'checked' : ''} ${!status.startup?.supported || (!status.background?.enabled && !status.startup?.installed) ? 'disabled' : ''}></label></div><div class="archive-actions"><button class="btn primary" data-history-action="scan" ${busy || !selectedSources.size ? 'disabled' : ''}>${status.chats ? 'Update archive now' : 'Save chats to Hub'}</button><span>${status.background?.running ? 'Automatic updates are already running.' : 'Reads selected sources without changing native files.'}</span></div><details class="archive-advanced" data-ui-key="history-advanced"><summary>Storage & troubleshooting</summary><p>Hub keeps captured messages, tool output and embedded content locally. Chats may contain private information. Attachment coverage is shown separately above. Data size counts current saved source versions; disk use can differ because of revisions, attachments and shared blocks.</p><p>If archive search cannot be read, rebuild its index from saved originals. Native client files stay unchanged.</p><button class="btn sm" data-history-action="rebuild" ${busy ? 'disabled' : ''}>Rebuild search index</button></details></div></details></section>`;
}
