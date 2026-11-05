import { escape } from '../shared/html.js';

export function setupMemoryUi({ api, load, notice, getState }) {
  const dialog = document.querySelector('#memory-dialog');
  const form = dialog.querySelector('#memory-form');
  const scope = dialog.querySelector('#memory-scope');
  const records = dialog.querySelector('#memory-records');
  const status = dialog.querySelector('#memory-status');
  const output = dialog.querySelector('#memory-output');
  const apply = dialog.querySelector('#memory-apply');
  const automation = dialog.querySelector('#memory-automation');
  const conflicts = dialog.querySelector('#memory-conflicts');
  const sources = dialog.querySelector('#memory-sources');
  const field = (name) => form.elements.namedItem(name);
  let selected;
  let plan;
  let busy = false;
  let version = 0;

  function invalidate() {
    ++version;
    plan = undefined;
    apply.disabled = true;
    output.textContent = '';
  }
  function reset() {
    selected = undefined;
    form.reset();
    field('id').readOnly = false;
    dialog.querySelector('[data-memory-delete]').disabled = true;
    invalidate();
  }
  function lock(value) {
    busy = value;
    for (const control of dialog.querySelectorAll('input,select,textarea,button'))
      control.disabled = value || control.hasAttribute('data-unavailable');
    dialog.querySelector('[data-memory-discover]').disabled = value || scope.value !== 'project';
    apply.disabled = value || !plan || plan.blocked;
    dialog.querySelector('[data-memory-delete]').disabled = value || !selected;
  }
  async function list() {
    invalidate();
    sources.textContent = '';
    dialog.querySelector('[data-memory-discover]').disabled = scope.value !== 'project';
    conflicts.textContent = '';
    const request = version;
    records.textContent = 'Loading scoped records…';
    automation.textContent =
      scope.value === 'shared'
        ? 'Automatic capture stays project-scoped. Promotion to shared knowledge is explicit.'
        : 'Loading project automation status…';
    try {
      const query = dialog.querySelector('#memory-query').value;
      const result = await api(`/api/memory?${new URLSearchParams({ scope: scope.value, query })}`);
      if (request !== version || !dialog.open) return;
      records.innerHTML = result.results.length
        ? result.results
            .map(
              (record) =>
                `<button class="btn memory-record" data-memory-id="${escape(record.id)}"><b>${escape(record.title)}</b><span class="mono muted">${escape(record.id)}</span></button>`,
            )
            .join('')
        : '<p class="muted">No records in this scope.</p>';
      status.textContent = `${result.results.length} of ${result.total} matching record(s).`;
      if (scope.value === 'project') {
        try {
          const automatic = await api('/api/memory/automation');
          if (request !== version || !dialog.open) return;
          automation.textContent = automatic.policy.enabled
            ? `Automatic memory enabled for ${automatic.policy.clients.join(', ')}. ${automatic.policy.native.length} native source(s), ${automatic.conflicts.length} conflict(s), ${automatic.pendingCheckpoints} pending checkpoint(s). Inspect memory auto status for details.`
            : 'Automatic memory is off. Use Connect project memory to preview setup, or memory auto enable for one client; subsequent captures use that policy.';
          conflicts.innerHTML = automatic.conflicts
            .map(
              (conflict) =>
                `<button class="btn memory-record" data-memory-conflict="${escape(conflict.id)}">Review conflict: ${escape(conflict.source)}</button>`,
            )
            .join('');
          const issues = automatic.native.flatMap((source) =>
            source.error
              ? [`${source.directory}: ${source.error}`]
              : source.skipped.map((item) => `${item.path}: ${item.reason}`),
          );
          if (issues.length) automation.textContent += ` Source issues: ${issues.join(' ')}`;
        } catch (error) {
          if (request === version) automation.textContent = error.message;
        }
      }
    } catch (error) {
      if (request !== version) return;
      records.textContent = error.message;
      status.textContent =
        'Project memory is optional. Use Connect project memory on Overview, or ahub project connect, to enable this project. Select Shared across projects for shared knowledge.';
    }
  }

  document.addEventListener('click', (event) => {
    if (!event.target.closest('[data-memory-open]') || busy) return;
    scope.value =
      getState?.().selection?.memoryScope ||
      getState?.().readiness?.memory.defaultScope ||
      'shared';
    dialog.querySelector('#memory-query').value = '';
    reset();
    dialog.showModal();
    list();
  });
  form.addEventListener('submit', (event) => event.preventDefault());
  form.addEventListener('input', invalidate);
  sources.addEventListener('change', invalidate);
  scope.addEventListener('change', () => {
    reset();
    list();
  });
  dialog.addEventListener('cancel', (event) => {
    if (busy) event.preventDefault();
    else invalidate();
  });
  dialog.addEventListener('click', async (event) => {
    const button = event.target.closest('button');
    if (!button || busy) return;
    if (button.hasAttribute('data-memory-close')) {
      invalidate();
      dialog.close();
      return;
    }
    if (button.hasAttribute('data-memory-new')) {
      reset();
      field('id').focus();
      return;
    }
    if (button.hasAttribute('data-memory-search')) {
      reset();
      await list();
      return;
    }
    if (button.hasAttribute('data-memory-discover')) {
      invalidate();
      lock(true);
      try {
        const report = await api('/api/memory/discovery');
        sources.innerHTML = `<p class="small-note">Choose existing notes for ${escape(report.workspace)}. Unresolved sources need your explicit project choice. No files changed.</p>${report.sources.map((source) => `<label class="small-note"><input type="checkbox" data-native-source value="${escape(source.id)}" ${source.format !== 'markdown' || (source.project && source.project !== report.workspace && source.projectId !== report.project) ? 'data-unavailable disabled' : ''} ${source.format === 'markdown' && report.project && source.projectId === report.project ? 'checked' : ''}> ${escape(source.client)} · ${escape(source.path)} · ${escape(source.format)}<br>${escape(source.evidence)}</label>`).join('')}<p class="small-note">${report.warnings.map(escape).join(' ')}</p><label class="small-note"><input type="checkbox" id="memory-follow"> Follow later changes from these sources. Enables this project's native-sync policy; lifecycle hook installation is separate.</label><button class="btn" data-memory-onboard>Preview importing selected notes</button>`;
        status.textContent = report.project
          ? 'Review source scope and preview the selected import.'
          : 'Connect this project first using Connect project memory on Overview or ahub project connect.';
      } catch (error) {
        status.textContent = error.message;
      } finally {
        lock(false);
      }
      return;
    }
    if (button.hasAttribute('data-memory-onboard')) {
      const chosen = [...sources.querySelectorAll('[data-native-source]:checked')].map(
        (input) => input.value,
      );
      if (!chosen.length) {
        status.textContent = 'Choose at least one Markdown source.';
        return;
      }
      const follow = sources.querySelector('#memory-follow').checked;
      invalidate();
      lock(true);
      try {
        plan = await api('/api/memory/onboarding/preview', { sources: chosen, follow });
        output.innerHTML = `<p>Import selected native knowledge into this project. ${follow ? 'Follow-up source imports will be enabled.' : 'This is a one-time import.'} Original notes stay intact.</p><ul>${plan.rows.map((row) => `<li>${escape(row.action)}: ${escape(row.name)} ${escape(row.note ?? '')}</li>`).join('')}</ul>`;
        status.textContent = `${plan.changes} managed path(s) would change. Review and apply this revision.`;
      } catch (error) {
        status.textContent = error.message;
      } finally {
        lock(false);
      }
      return;
    }
    if (button.dataset.memoryConflict) {
      invalidate();
      const request = version;
      try {
        const conflict = await api(
          `/api/memory/conflict?${new URLSearchParams({ id: button.dataset.memoryConflict })}`,
        );
        if (request !== version || !dialog.open) return;
        output.innerHTML = `<p>${escape(conflict.reason)}</p><b>Current Hub value</b><pre class="code">${escape(conflict.current ? `${conflict.current.title}\n\n${conflict.current.body}` : '(Record deleted)')}</pre><b>Incoming source value</b><pre class="code">${escape(`${conflict.incoming.title}\n\n${conflict.incoming.body}`)}</pre><button class="btn" data-memory-resolve="hub" data-conflict-id="${escape(conflict.id)}">Preview keeping Hub</button> <button class="btn" data-memory-resolve="incoming" data-conflict-id="${escape(conflict.id)}">Preview taking incoming</button>`;
        status.textContent = 'Compare both versions, then preview a resolution.';
      } catch (error) {
        if (request === version) status.textContent = error.message;
      }
      return;
    }
    if (button.dataset.memoryResolve) {
      const input = { id: button.dataset.conflictId, take: button.dataset.memoryResolve };
      invalidate();
      lock(true);
      try {
        plan = await api('/api/memory/conflict/preview', input);
        output.textContent = `Keep the ${input.take === 'hub' ? 'current Hub value (including deletion)' : 'incoming source value'}. ${plan.changes} managed path(s) would change. Apply saves a private backup; the native source stays intact.`;
        status.textContent = 'Resolution preview ready. Apply to confirm this exact revision.';
      } catch (error) {
        status.textContent = error.message;
      } finally {
        lock(false);
      }
      return;
    }
    if (button.dataset.memoryId) {
      invalidate();
      const request = version;
      try {
        const record = await api(
          `/api/memory?${new URLSearchParams({ scope: scope.value, id: button.dataset.memoryId })}`,
        );
        if (request !== version || !dialog.open) return;
        selected = record;
        for (const name of ['id', 'title', 'body', 'kind', 'source'])
          field(name).value = record[name] ?? '';
        field('tags').value = record.tags.join(', ');
        field('id').readOnly = true;
        dialog.querySelector('[data-memory-delete]').disabled = false;
        status.textContent = `Editing ${record.id}; changes require a fresh preview.`;
      } catch (error) {
        if (request === version) status.textContent = error.message;
      }
      return;
    }
    if (button.hasAttribute('data-memory-preview') || button.hasAttribute('data-memory-delete')) {
      const deleting = button.hasAttribute('data-memory-delete');
      if (deleting && !selected) return;
      if (!deleting && !form.reportValidity()) return;
      invalidate();
      lock(true);
      try {
        const input = {
          scope: scope.value,
          operation: deleting ? 'delete' : selected ? 'update' : 'create',
          id: field('id').value,
          ...(selected ? { recordRevision: selected.revision } : {}),
        };
        if (!deleting)
          Object.assign(input, {
            title: field('title').value,
            body: field('body').value,
            kind: field('kind').value,
            tags: field('tags')
              .value.split(',')
              .map((tag) => tag.trim())
              .filter(Boolean),
            source: field('source').value || null,
          });
        plan = await api('/api/memory/preview', input);
        output.innerHTML = `<p><b>${deleting ? 'Delete' : selected ? 'Update' : 'Create'} ${escape(input.id)}</b> in ${escape(scope.value)} memory. No files changed.</p><ul>${plan.rows.map((row) => `<li>${escape(row.action)}: ${escape(row.name)}</li>`).join('')}</ul><p>Apply saves a private backup. This preview expires in five minutes.</p>`;
        status.textContent = `${plan.changes} managed path(s) would change.`;
      } catch (error) {
        status.textContent = error.message;
      } finally {
        lock(false);
      }
      return;
    }
    if (button === apply && plan) {
      lock(true);
      try {
        const result = await api('/api/memory/apply', { id: plan.id, revision: plan.revision });
        reset();
        await list();
        output.textContent = `Applied with backup: ${result.backup}.`;
        if (result.restoreCommand) {
          const command = document.createElement('pre');
          command.className = 'code';
          command.textContent = result.restoreCommand;
          output.append(command);
        }
        notice(
          'Memory saved. MCP reads see the updated record; deliver shared context again to refresh embedded indexes.',
        );
        await load();
      } catch (error) {
        invalidate();
        status.textContent = `${error.message} Review a fresh preview.`;
      } finally {
        lock(false);
      }
    }
  });
}
