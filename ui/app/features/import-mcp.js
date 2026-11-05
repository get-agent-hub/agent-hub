import { escape, pill, empty } from '../shared/html.js';
import { clientLabels as labels } from '../shared/navigation.js';
export function setupImportUi({ api, load, notice, getState }) {
  const $ = (s) => document.querySelector(s);
  let importSource,
    importName,
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
        `${importSource ? `<div class="mcp-guide"><b>${escape(importName)}</b><p>Use the copy from ${escape(labels[importSource])} as the Hub definition. Only this server in Hub is updated. Other clients keep their current settings until you review a separate connection.</p></div>` : ''}<div class="card table-wrap">${plan.servers.length ? `<table class="table"><thead><tr><th>Server</th><th>Action</th><th>Found in</th><th>Details</th></tr></thead><tbody>${plan.servers.map((r) => `<tr><td><b>${escape(r.name)}</b></td><td>${pill({ add: 'Add to Hub', update: 'Replace Hub copy', 'skip-exists': 'Keep current Hub copy', conflict: 'Choose a source', error: 'Cannot import' }[r.action] || r.action, ['add', 'update'].includes(r.action) ? 'ok' : r.action === 'skip-exists' ? '' : 'warn')}</td><td>${escape(r.from.map((c) => labels[c]).join(', ') || '—')}</td><td class="muted">${escape(r.action === 'skip-exists' ? 'Already in hub' : r.note || (r.secrets.length ? `${r.secrets.length} secret fields → .env` : 'Ready'))}</td></tr>`).join('')}</tbody></table>` : empty('No client definitions found', 'Add an MCP server in a client first.')}</div><details class="import-terms"><summary>Storage details</summary>${changed} server(s) will be written to <code>mcp/servers.yaml</code>. ${plan.envVarsToAdd.length} new secret(s) go to <code>.env</code>. Client configurations stay as they are.${plan.envVarsToAdd.length ? `<p>New variable names: ${plan.envVarsToAdd.map((v) => `<code>${escape(v)}</code>`).join(', ')}</p>` : ''}</details>`;
      $('#import-summary').textContent = plan.blocked
        ? 'Review the issues below before saving'
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
    importName = name;
    $('#import-title').textContent = source
      ? `Use ${labels[source]} settings in Hub`
      : 'Add MCP servers to Hub';
    $('#import-dialog .import-options').hidden = !!source;
    $('#import-title').nextElementSibling.textContent = source
      ? `Review only ${name}. Client configurations are not changed by this step.`
      : 'Collect existing server settings. You will review client connections separately.';
    const state = getState();
    if (!state) return;
    $('#import-item').innerHTML =
      `<option value="mcp">All MCP servers</option>${state.status.mcp.map((s) => `<option value="${escape(`mcp:${s.name}`)}">${escape(s.name)}</option>`).join('')}`;
    $('#import-item').value = name ? `mcp:${name}` : 'mcp';
    $('#import-overwrite').checked = !!source;
    $('#import-prefer').value = '';
    $('#import-item').disabled = !!source;
    $('#import-prefer').disabled = !!source;
    $('#import-apply').textContent = source ? 'Save this copy in Hub' : 'Import into hub';
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
      .querySelectorAll(
        '#import-dialog .import-options input, #import-dialog .import-options select',
      )
      .forEach((el) => (el.disabled = true));
    try {
      const result = await api('/api/import/apply', { id: importPlan.id });
      $('#import-dialog').close();
      notice(
        `Saved ${result.imported} server(s) in Hub. Review client connections separately to use these settings in other clients.`,
      );
      await load();
    } catch (error) {
      importPlan = undefined;
      $('#import-preview').innerHTML =
        `<div class="import-error">${escape(error.message)}</div><p><button class="btn" data-action="retry-preview">Review a new preview</button></p>`;
      $('#import-summary').textContent = 'Import not completed';
    } finally {
      applying = false;
      $('#import-apply').textContent = importSource ? 'Save this copy in Hub' : 'Import into hub';
      document
        .querySelectorAll(
          '#import-dialog .import-options input, #import-dialog .import-options select',
        )
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
