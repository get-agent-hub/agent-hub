import { escape, pill, empty } from '../shared/html.js';
import { clientLabels as labels } from '../shared/navigation.js';
export function setupImportUi({ api, load, notice, getState }) {
  const $ = (s) => document.querySelector(s);
  let importSource,
    importPlan,
    previewVersion = 0,
    applying = false;
  async function previewImport() {
    const version = ++previewVersion;
    importPlan = undefined;
    $('#import-apply').disabled = true;
    $('#import-preview').innerHTML = '<div class="empty">Reading client definitions…</div>';
    $('#import-summary').textContent = 'Building preview…';
    try {
      const plan = await api('/api/import/preview', {
        item: $('#import-item').value,
        source: importSource,
        prefer: $('#import-prefer').value,
        overwrite: $('#import-overwrite').checked,
      });
      if (version !== previewVersion || !$('#import-dialog').open) return;
      importPlan = plan;
      const changed = plan.servers.filter((r) => ['add', 'update'].includes(r.action)).length;
      $('#import-preview').innerHTML =
        `<div class="card table-wrap">${plan.servers.length ? `<table class="table"><thead><tr><th>Server</th><th>Action</th><th>Found in</th><th>Details</th></tr></thead><tbody>${plan.servers.map((r) => `<tr><td><b>${escape(r.name)}</b></td><td>${pill(r.action, ['add', 'update'].includes(r.action) ? 'ok' : r.action === 'skip-exists' ? '' : 'warn')}</td><td>${escape(r.from.map((c) => labels[c]).join(', ') || '—')}</td><td class="muted">${escape(r.action === 'skip-exists' ? 'Already in hub' : r.note || (r.secrets.length ? `${r.secrets.length} secret fields → .env` : 'Ready'))}</td></tr>`).join('')}</tbody></table>` : empty('No client definitions found', 'Add an MCP server in a client first.')}</div><div class="import-terms">${changed} server(s) will be written to <code>mcp/servers.yaml</code>. ${plan.envVarsToAdd.length} new secret(s) go to <code>.env</code>. Client configurations stay as they are.${plan.envVarsToAdd.length ? `<p>New variable names: ${plan.envVarsToAdd.map((v) => `<code>${escape(v)}</code>`).join(', ')}</p>` : ''}</div>`;
      $('#import-summary').textContent = plan.blocked
        ? 'Choose a source for conflicting definitions'
        : changed
          ? `${changed} server(s) ready to import`
          : 'Nothing to import';
      $('#import-apply').disabled = plan.blocked || !changed;
    } catch (error) {
      if (version !== previewVersion) return;
      $('#import-preview').innerHTML =
        `<div class="import-error">${escape(error.message)}</div><p><button class="btn" data-action="retry-preview">Retry preview</button></p>`;
      $('#import-summary').textContent = 'Preview unavailable';
    }
  }

  function openImport(name, source) {
    importSource = source;
    const state = getState();
    if (!state) return;
    $('#import-item').innerHTML =
      `<option value="mcp">All MCP servers</option>${state.status.mcp.map((s) => `<option value="${escape(`mcp:${s.name}`)}">${escape(s.name)}</option>`).join('')}`;
    $('#import-item').value = name ? `mcp:${name}` : 'mcp';
    $('#import-overwrite').checked = !!source;
    $('#import-prefer').value = source || '';
    $('#import-item').disabled = !!source;
    $('#import-prefer').disabled = !!source;
    $('#import-dialog').showModal();
    previewImport();
  }

  $('#import-dialog').addEventListener('cancel', (event) => {
    if (applying) event.preventDefault();
    else ++previewVersion;
  });
  $('#import-apply').addEventListener('click', async () => {
    if (!importPlan || applying) return;
    applying = true;
    $('#import-apply').disabled = true;
    $('#import-apply').textContent = 'Importing…';
    document
      .querySelectorAll('.import-options input, .import-options select')
      .forEach((el) => (el.disabled = true));
    try {
      const result = await api('/api/import/apply', { id: importPlan.id });
      $('#import-dialog').close();
      notice(
        `Imported ${result.imported} server(s) into your hub.${result.commit ? ` Commit ${result.commit}.` : ''}`,
      );
      await load();
    } catch (error) {
      importPlan = undefined;
      $('#import-preview').innerHTML =
        `<div class="import-error">${escape(error.message)}</div><p><button class="btn" data-action="retry-preview">Review a new preview</button></p>`;
      $('#import-summary').textContent = 'Import not completed';
    } finally {
      applying = false;
      $('#import-apply').textContent = 'Import into hub';
      document
        .querySelectorAll('.import-options input, .import-options select')
        .forEach((el) => (el.disabled = false));
    }
  });

  document.addEventListener('click', (event) => {
    const b = event.target.closest('[data-action]');
    if (!b) return;
    if (b.dataset.action === 'import') openImport(b.dataset.name);
    if (b.dataset.action === 'close-import' && !applying) {
      ++previewVersion;
      $('#import-dialog').close();
    }
    if (b.dataset.action === 'retry-preview') previewImport();
  });
  document.addEventListener('click', (event) => {
    const d = event.target.closest('[data-direction]');
    if (d?.dataset.area === 'mcp' && d.dataset.direction === 'import')
      openImport(d.dataset.name, d.dataset.client);
  });
  document.addEventListener('change', (event) => {
    if (['import-item', 'import-prefer', 'import-overwrite'].includes(event.target.id))
      previewImport();
  });
}
