import { escape, pill, link } from '../shared/html.js';
export function setupSyncUi({ api, load, notice, getState }) {
  const $ = (s) => document.querySelector(s);
  let syncSelection,
    syncPlan,
    syncVersion = 0,
    syncApplying = false;
  function commandBlock(key, title, command) {
    return `<div class="command-block"><div class="card-h"><b>${escape(title)}</b><span class="spacer"></span><button class="btn sm" data-action="copy-command" data-key="${key}">Copy command</button></div><pre class="code">${escape(command)}</pre></div>`;
  }

  async function copySyncCommand(key) {
    const value = syncPlan?.commands?.[key];
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      notice('Command copied.');
    } catch {
      notice('Select and copy the command from the preview.', true);
    }
  }

  async function previewSync() {
    if (syncApplying) return;
    const version = ++syncVersion;
    syncPlan = undefined;
    $('#sync-apply').disabled = true;
    $('#sync-preview').innerHTML = '<div class="empty">Building a dry run…</div>';
    $('#sync-summary').textContent = 'Reading client configurations…';
    try {
      const plan = await api('/api/sync/preview', {
        ...syncSelection,
        client: $('#sync-client').value || undefined,
      });
      if (version !== syncVersion || !$('#sync-dialog').open) return;
      syncPlan = plan;
      const changed = plan.files.filter((f) => f.changed).length;
      const tones = {
        add: 'ok',
        replace: 'accent',
        keep: '',
        remove: 'warn',
        preserve: '',
        skip: '',
        conflict: 'err',
      };
      const hasConflicts = plan.files.some((file) =>
        file.rows.some((row) => row.action === 'conflict' && row.name !== '*'),
      );
      $('#sync-preview').innerHTML =
        `${plan.blocked ? `<div class="import-error">${hasConflicts ? 'Some clients have different settings. Use “Choose settings” below to decide which copy to keep; then review delivery again.' : 'A client configuration cannot be updated. Review the problem below before retrying.'}</div>` : '<p class="route-note">Dry run complete. No files written. Applying creates a private backup and checks that this plan is still current.</p>'}
        <details class="card section-gap"><summary class="card-h">Terminal commands</summary><div class="card-b">${commandBlock('dryRun', 'Repeat this dry run', plan.commands.dryRun)}
        ${!plan.blocked && changed ? commandBlock('apply', 'Apply the reviewed plan', plan.commands.apply) : ''}</div></details>
      ${plan.files.map((f) => `<div class="card sync-file"><div class="card-h"><h3>${escape(f.label)}</h3>${pill(f.changed ? 'Will change' : 'Unchanged', f.changed ? 'accent' : '')}<span class="file-path mono">${escape(f.path)}</span></div>${f.problem ? `<div class="card-b import-error">${escape(f.problem)}</div>` : ''}<div class="table-wrap"><table class="table"><thead><tr><th>Server</th><th>Action</th><th>Details</th></tr></thead><tbody>${f.rows.map((r) => `<tr><td><b>${escape(r.name)}</b>${r.action === 'conflict' && r.name !== '*' ? `<p><a class="btn sm" href="${link('mcp', { name: r.name })}" data-action="close-sync">Choose settings…</a></p>` : ''}</td><td>${pill({ add: 'Add connection', replace: 'Replace this entry', keep: 'Already connected', remove: 'Remove owned entry', preserve: 'Leave unchanged', skip: 'Not selected', conflict: 'Choose settings' }[r.action] || r.action, tones[r.action])}</td><td><span class="muted">${escape((r.action === 'replace' ? 'Use Hub settings for this server. Other entries stay as they are.' : r.action === 'add' ? 'Add a connection to the Hub copy.' : null) || r.note || (r.preservedSettings?.length ? `Local settings kept: ${r.preservedSettings.join(', ')}` : r.action === 'keep' ? 'Already uses the hub launcher' : 'Launch through the hub'))}</span>${r.command && ['add', 'replace'].includes(r.action) ? `<details><summary class="small-note">Launch command</summary><div class="sync-row-command">${escape(r.command)}</div></details>` : ''}</td></tr>`).join('')}</tbody></table></div></div>`).join('')}
      <p class="small-note">MCP configuration only. Client-only entries and local tool policies are preserved. Restart affected clients after applying.</p>`;
      $('#sync-summary').textContent = plan.blocked
        ? 'Review the issues below'
        : changed
          ? `${changed} ${changed === 1 ? 'client' : 'clients'} will be updated`
          : 'No changes needed';
      $('#sync-apply').disabled = plan.blocked || !changed;
    } catch (error) {
      if (version !== syncVersion) return;
      $('#sync-preview').innerHTML =
        `<div class="import-error">${escape(error.message)}</div><p><button class="btn" data-action="retry-sync">Retry dry run</button></p>`;
      $('#sync-summary').textContent = 'Dry run unavailable';
    }
  }

  function openSync(selection) {
    syncSelection = selection;
    const name = selection?.only?.[0];
    const client = selection?.client;
    const label = getState()?.status.clients.find((item) => item.id === client)?.label || client;
    $('#sync-title').textContent = name
      ? `Use Hub settings in ${label}`
      : 'Review client connections';
    $('#sync-title').nextElementSibling.textContent = name
      ? `Review only ${name} in ${label}. Other servers and local settings are preserved.`
      : 'Review which client files will change before applying.';
    $('#sync-client').closest('label').hidden = !!client;
    $('#sync-client').value = selection?.client || '';
    $('#sync-client').disabled = !!selection;
    if (!getState()) return;
    $('#sync-dialog').showModal();
    previewSync();
  }

  $('#sync-dialog').addEventListener('cancel', (event) => {
    if (syncApplying) event.preventDefault();
    else ++syncVersion;
  });
  $('#sync-apply').addEventListener('click', async () => {
    if (!syncPlan || syncPlan.blocked || syncApplying) return;
    syncApplying = true;
    $('#sync-apply').disabled = true;
    $('#sync-client').disabled = true;
    $('#sync-apply').textContent = 'Applying…';
    try {
      const result = await api('/api/sync/apply', { id: syncPlan.id });
      $('#sync-preview').innerHTML =
        `<div class="banner ok"><div><b>Synced ${result.changedFiles} client file(s).</b><p>Restart the affected clients to load the new MCP configuration.</p></div></div>${result.backup ? `<p class="small-note">Backup: ${escape(result.backup)}</p>` : ''}${result.restoreCommand ? commandBlock('restore', 'Preview rollback in your terminal', result.restoreCommand) : ''}`;
      syncPlan.commands = { restore: result.restoreCommand };
      $('#sync-summary').textContent = 'Client connections updated';
      notice(`Synced ${result.changedFiles} client file(s). Restart affected clients.`);
      await load();
    } catch (error) {
      syncPlan = undefined;
      $('#sync-preview').innerHTML =
        `<div class="import-error">${escape(error.message)}</div><p><button class="btn" data-action="retry-sync">Review a new dry run</button></p>`;
      $('#sync-summary').textContent = 'Sync not completed';
    } finally {
      syncApplying = false;
      $('#sync-client').disabled = false;
      $('#sync-apply').textContent = 'Apply with backup';
    }
  });

  document.addEventListener('click', (event) => {
    const target = event.target.closest('[data-mcp-deliver]');
    if (target) {
      openSync({
        client: target.dataset.client,
        only: [target.dataset.mcpDeliver],
        ...(target.dataset.replace === 'true' ? { replace: [target.dataset.mcpDeliver] } : {}),
      });
      return;
    }
    const d = event.target.closest('[data-direction]');
    if (d?.dataset.area === 'mcp' && d.dataset.direction === 'deliver') {
      openSync({ client: d.dataset.client, only: [d.dataset.name], replace: [d.dataset.name] });
      return;
    }
    const b = event.target.closest('[data-action]');
    if (!b) return;
    const action = b.dataset.action;
    if (action === 'sync') openSync();
    if (action === 'close-sync' && !syncApplying) {
      ++syncVersion;
      $('#sync-dialog').close();
    }
    if (action === 'retry-sync' && !syncApplying) previewSync();
    if (action === 'copy-command') copySyncCommand(b.dataset.key);
  });
  document.addEventListener('change', (event) => {
    if (event.target.id === 'sync-client') previewSync();
  });
}
