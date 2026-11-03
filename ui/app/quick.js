import { escape, pill } from './html.js';

export function setupQuickUi({ api, load, notice, getState }) {
  const dialog = document.querySelector('#quick-dialog');
  const output = document.querySelector('#quick-preview');
  const summary = document.querySelector('#quick-summary');
  const apply = document.querySelector('#quick-apply');
  const preview = document.querySelector('#quick-preview-button');
  const options = document.querySelector('#quick-options');
  let plan;
  let busy = false;
  let version = 0;

  function controls(value) {
    busy = value;
    for (const control of dialog.querySelectorAll('button, input, select'))
      control.disabled = value || control.dataset.quickUnavailable === 'true';
    apply.disabled = value || !plan || plan.blocked;
  }
  function reviewPage(id) {
    if (id.toLowerCase().includes('mcp')) return 'mcp';
    if (id.toLowerCase().includes('skill')) return 'skills';
    if (id.startsWith('repo') || id === 'project') return 'repos';
    return 'memory';
  }
  function render(result, applied = false) {
    output.innerHTML = `<p class="route-note">${applied ? 'Setup results. Review anything that needs attention below.' : 'This approves a staged workflow. Delivery plans are rebuilt after collection. A blocked client or area stays untouched while independent stages continue.'}</p>
      <p><b>Hub:</b> <code>${escape(result.root)}</code><br><b>Project:</b> ${escape(result.workspace || 'Global setup only')}${result.projectId ? ` · ${escape(result.projectId)}` : ''}</p>
      <ul class="list">${result.steps
        .map(
          (step) =>
            `<li><div class="copy"><b>${escape(step.title)}</b> ${pill(step.status, ['review', 'failed'].includes(step.status) ? 'warn' : step.status === 'done' ? 'ok' : '')}${step.note ? `<p class="sub">${escape(step.note)}</p>` : ''}${(
              step.rows || []
            )
              .filter((row) => ['conflict', 'error', 'preserve'].includes(row.action))
              .map(
                (row) =>
                  `<p class="sub">Review ${escape(row.name)}: ${escape(row.note || row.action)}</p>`,
              )
              .join(
                '',
              )}${!applied && step.rows?.length ? `<details><summary>${step.rows.length} item(s) found</summary><ul>${step.rows.map((row) => `<li>${escape(row.name)} · ${escape(row.action)}${row.note ? ` · ${escape(row.note)}` : ''}</li>`).join('')}</ul></details>` : ''}${step.changed !== undefined ? `<p class="sub">${step.changed} change(s)</p>` : ''}${applied && ['review', 'failed'].includes(step.status) ? `<a class="btn sm" href="#/${reviewPage(step.id)}" data-quick-close>Review ${reviewPage(step.id)} →</a>` : ''}${step.restoreCommand ? `<details><summary>Restore this stage</summary><pre>${escape(step.restoreCommand)}</pre></details>` : ''}</div></li>`,
        )
        .join('')}</ul>
      ${(result.warnings || []).map((warning) => `<p class="small-note">${escape(warning)}</p>`).join('')}
      ${(result.next || []).map((next) => `<p class="route-note">${escape(next)}</p>`).join('')}
      <p class="small-note">${escape(result.recovery)}</p><details><summary>Preview original-state recovery</summary><pre>${escape(result.resetCommand || result.commands.reset)}</pre></details>`;
  }
  async function build() {
    if (busy) return;
    const current = ++version;
    plan = undefined;
    controls(true);
    output.textContent = 'Finding your clients, tools, skills and project memory…';
    try {
      const result = await api('/api/quick/preview', {
        clients: [...dialog.querySelectorAll('[data-quick-client]:checked')].map(
          (input) => input.value,
        ),
        prefer: document.querySelector('#quick-prefer').value || undefined,
        project: document.querySelector('#quick-project').checked,
        automation: document.querySelector('#quick-automation').checked,
      });
      if (current !== version) return;
      plan = result;
      render(result);
      summary.textContent = result.blocked
        ? 'No enabled clients detected.'
        : 'No files changed. Ready to apply this workflow.';
    } catch (error) {
      output.textContent = error.message;
      summary.textContent = 'Preview failed. No setup was applied.';
    } finally {
      controls(false);
    }
  }
  options.addEventListener('change', () => {
    ++version;
    plan = undefined;
    apply.disabled = true;
    output.textContent = '';
    summary.textContent = 'Options changed. Preview again before applying.';
  });
  preview.addEventListener('click', build);
  apply.addEventListener('click', async () => {
    if (busy || !plan || plan.blocked) return;
    const reviewed = plan;
    plan = undefined;
    controls(true);
    summary.textContent = 'Applying guarded setup stages…';
    try {
      const result = await api('/api/quick/apply', {
        previewId: reviewed.previewId,
        revision: reviewed.revision,
      });
      render(result, true);
      options.hidden = true;
      apply.hidden = true;
      summary.textContent =
        result.status === 'complete'
          ? 'Hub connected. Restart your client sessions.'
          : 'Setup finished with items that need review.';
      await load();
    } catch (error) {
      summary.textContent = 'Setup stopped. Review the error and preview again.';
      output.textContent = error.message;
      notice(error.message, true);
    } finally {
      controls(false);
    }
  });
  document.addEventListener('click', (event) => {
    if (event.target.closest('[data-quick-close]') && !busy) dialog.close();
    if (!event.target.closest('[data-quick-open]') || busy) return;
    plan = undefined;
    options.hidden = false;
    apply.hidden = false;
    output.textContent = '';
    summary.textContent = 'Choose clients, then preview. No files changed.';
    document.querySelector('#quick-clients').innerHTML = getState()
      .status.clients.map(
        (client) =>
          `<label class="checkbox"><input type="checkbox" data-quick-client value="${escape(client.id)}" ${client.installed && (getState().quickClients || [client.id]).includes(client.id) ? 'checked' : 'disabled data-quick-unavailable="true"'} /> ${escape(client.label)}${client.installed ? (getState().quickClients && !getState().quickClients.includes(client.id) ? ' (disabled in Hub)' : '') : ' (not detected)'}</label>`,
      )
      .join('');
    apply.disabled = true;
    dialog.showModal();
  });
  dialog.addEventListener('cancel', (event) => {
    if (busy) event.preventDefault();
  });
}
