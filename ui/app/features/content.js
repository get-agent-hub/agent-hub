import { escape, pill } from '../shared/html.js';

const titles = {
  'project-disconnect': 'Disconnect selected project · retain knowledge and notes',
  'skills-import': 'Import skills into Hub',
  'skills-sync': 'Deliver skills to clients',
  'context-sync': 'Deliver shared instructions and memory',
  'init-repo': 'Prepare this repository for agents',
};

export function setupContentUi({ api, load, notice, track = () => {} }) {
  const dialog = document.querySelector('#content-dialog');
  const client = dialog.querySelector('#content-client');
  const preference = dialog.querySelector('#content-preference');
  const overwrite = dialog.querySelector('#content-overwrite');
  const replacements = dialog.querySelector('#content-replacements');
  const output = dialog.querySelector('#content-preview');
  const summary = dialog.querySelector('#content-summary');
  const apply = dialog.querySelector('#content-apply');
  let operation;
  let selection;
  let plan;
  let busy = false;
  let version = 0;

  async function preview() {
    if (busy) return;
    const current = ++version;
    plan = undefined;
    apply.disabled = true;
    output.textContent = 'Building a dry run…';
    summary.textContent = 'No files changed.';
    try {
      const options = { operation, ...selection };
      if (['skills-sync', 'context-sync'].includes(operation))
        options.client = client.value || undefined;
      if (operation === 'skills-sync' && replacements.value.trim())
        options.replace = replacements.value
          .split(',')
          .map((name) => name.trim())
          .filter(Boolean);
      if (operation === 'skills-import') {
        options.prefer = preference.value || undefined;
        options.overwrite = overwrite.checked;
      }
      const result = await api('/api/content/preview', options);
      if (current !== version || !dialog.open) return;
      plan = result;
      output.innerHTML = `<p class="route-note">Dry run only. Apply checks this exact revision, records originals and creates a private backup.</p><div class="table-wrap"><table class="table"><thead><tr><th>Item</th><th>Client</th><th>Action</th><th>Path & details</th></tr></thead><tbody>${result.rows.map((row) => `<tr><td>${escape(row.name)}</td><td>${escape(row.client)}</td><td>${pill(row.action, row.action === 'conflict' ? 'err' : '')}</td><td><div class="mono">${escape(row.path)}</div><span class="muted">${escape(row.note ?? '')}</span></td></tr>`).join('')}</tbody></table></div><div class="command-block"><div class="card-h"><b>Dry-run command</b><button class="btn sm" data-content-copy="dryRun">Copy</button></div><pre class="code">${escape(result.commands.dryRun)}</pre></div>${result.blocked ? '<p class="import-error">Resolve conflicts and review a new plan before applying.</p>' : result.changes ? `<div class="command-block"><div class="card-h"><b>Apply this exact plan</b><button class="btn sm" data-content-copy="apply">Copy</button></div><pre class="code">${escape(result.commands.apply)}</pre></div>` : '<p>No changes needed.</p>'}`;
      summary.textContent = result.blocked
        ? 'Blocked by conflicts'
        : `${result.changes} managed path(s) would change`;
      apply.disabled = result.blocked || !result.changes;
    } catch (error) {
      if (current !== version) return;
      output.textContent = error.message;
      summary.textContent = 'Preview unavailable';
    }
  }

  document.addEventListener('click', (event) => {
    const trigger = event.target.closest(
      '[data-content-operation], [data-direction][data-area="skills"]',
    );
    if (!trigger || busy) return;
    const { direction, name, client: selectedClient } = trigger.dataset;
    operation = direction
      ? direction === 'import'
        ? 'skills-import'
        : 'skills-sync'
      : trigger.dataset.contentOperation;
    selection =
      direction === 'import'
        ? { name, source: selectedClient }
        : direction
          ? { only: [name] }
          : undefined;
    if (!titles[operation]) return;
    dialog.querySelector('#content-title').textContent = titles[operation];
    client.closest('label').hidden = !['skills-sync', 'context-sync'].includes(operation);
    preference.closest('label').hidden = operation !== 'skills-import';
    overwrite.closest('label').hidden = operation !== 'skills-import';
    replacements.closest('label').hidden = operation !== 'skills-sync';
    client.value = selectedClient || '';
    preference.value = direction === 'import' ? selectedClient : '';
    overwrite.checked = direction === 'import';
    replacements.value = direction === 'deliver' ? name : '';
    for (const control of [client, preference, overwrite, replacements])
      control.disabled = !!direction;
    dialog.showModal();
    preview();
  });
  dialog.addEventListener('click', async (event) => {
    const button = event.target.closest('button');
    if (!button) return;
    if (button.hasAttribute('data-content-close') && !busy) {
      ++version;
      dialog.close();
    }
    if (button.hasAttribute('data-content-preview')) preview();
    if (button.dataset.contentCopy && plan?.commands[button.dataset.contentCopy]) {
      try {
        await navigator.clipboard.writeText(plan.commands[button.dataset.contentCopy]);
        notice('Command copied.');
      } catch {
        notice('Select and copy the command from the preview.', true);
      }
    }
  });
  dialog.addEventListener('change', preview);
  dialog.addEventListener('cancel', (event) => {
    if (busy) event.preventDefault();
    else ++version;
  });
  apply.addEventListener('click', async () => {
    if (!plan || plan.blocked || busy) return;
    busy = true;
    apply.disabled = true;
    for (const control of dialog.querySelectorAll('select,input')) control.disabled = true;
    try {
      const result = await api('/api/content/apply', { id: plan.id });
      if (result.changedPaths > 0 && ['skills-sync', 'context-sync'].includes(operation))
        track('shared_config_delivered');
      output.innerHTML = `<div class="banner ok"><b>Updated ${result.changedPaths} managed path(s).</b></div><p>Restart affected clients. Repository notes remain editable by you and your agents.</p>${result.backup ? `<p class="small-note">Backup: ${escape(result.backup)}</p>` : ''}${result.restoreCommand ? `<pre class="code">${escape(result.restoreCommand)}</pre>` : ''}`;
      summary.textContent = 'Applied with backup';
      plan = undefined;
      await load();
    } catch (error) {
      output.textContent = error.message;
      summary.textContent = 'Not applied; review a fresh plan.';
      plan = undefined;
    } finally {
      busy = false;
      for (const control of dialog.querySelectorAll('select,input')) control.disabled = false;
    }
  });
}
