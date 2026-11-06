import { escape } from '../shared/html.js';
import { clientLabels } from '../shared/navigation.js';

export function setupHistoryHandoffUi({ api, notice }) {
  const dialog = document.querySelector('#handoff-dialog');
  const output = dialog.querySelector('#handoff-preview');
  const target = dialog.querySelector('#handoff-target');
  const nextStep = dialog.querySelector('#handoff-next');
  const actions = [...dialog.querySelectorAll('[data-handoff-copy], [data-handoff-download]')];
  let selection;
  let packet;
  let version = 0;
  function input() {
    return { ...selection, target: target.value, nextStep: nextStep.value };
  }
  async function prepare() {
    const current = ++version;
    actions.forEach((button) => {
      button.disabled = true;
    });
    output.textContent = 'Preparing excerpts from the selected preserved version…';
    try {
      const result = await api('/api/history/handoff', input());
      if (current !== version || !dialog.open) return;
      packet = result;
      output.innerHTML = `<p class="small-note">${result.references.length} original messages${result.projects.length ? ` · ${escape(result.projects.map((project) => project.label).join(', '))}` : ''}. Review private information before sharing.</p>${result.warnings
        .slice(3)
        .map((warning) => `<p class="small-note">${escape(warning)}</p>`)
        .join(
          '',
        )}<div class="handoff-messages">${result.references.map((reference) => `<article class="card"><div class="card-h"><b>${escape(reference.role)}</b><a class="btn sm" href="${escape(reference.link)}" target="_blank" rel="noopener">Read in Hub ↗</a></div><pre class="document-view">${escape(reference.text)}</pre>${reference.shortened ? '<p class="small-note">Shortened excerpt. Open the source to read the full message.</p>' : ''}</article>`).join('')}</div><p class="small-note">Open a new conversation in ${escape(clientLabels[result.target])} and paste the copied context.</p><details><summary>Full context packet & retrieval details</summary>${result.warnings
        .slice(0, 3)
        .map((warning) => `<p class="small-note">${escape(warning)}</p>`)
        .join('')}<pre class="document-view">${escape(result.text)}</pre></details>`;
      actions.forEach((button) => {
        button.disabled = false;
      });
    } catch (error) {
      if (current === version) {
        packet = undefined;
        output.textContent = error.message;
      }
    }
  }
  document.addEventListener('click', (event) => {
    const trigger = event.target.closest('[data-history-handoff]');
    if (!trigger) return;
    selection = { id: trigger.dataset.historyHandoff, revision: trigger.dataset.revision };
    nextStep.value = '';
    packet = undefined;
    dialog.showModal();
    void prepare();
  });
  dialog
    .querySelectorAll('[data-handoff-close]')
    .forEach((button) => button.addEventListener('click', () => dialog.close()));
  dialog.addEventListener('close', () => {
    version++;
    packet = undefined;
    selection = undefined;
    output.textContent = '';
    actions.forEach((button) => {
      button.disabled = true;
    });
  });
  window.addEventListener('hashchange', () => {
    if (dialog.open) dialog.close();
  });
  dialog.querySelector('[data-handoff-prepare]').addEventListener('click', () => {
    void prepare();
  });
  for (const element of [target, nextStep])
    element.addEventListener('input', () => {
      version++;
      packet = undefined;
      output.textContent = 'Choose Prepare context to refresh the preview.';
      actions.forEach((button) => {
        button.disabled = true;
      });
    });
  actions.forEach((button) =>
    button.addEventListener('click', () => {
      void (async () => {
        if (!packet) return;
        const current = version;
        const fresh = await api('/api/history/handoff', input());
        if (current !== version || !dialog.open) return;
        if (fresh.digest !== packet.digest) {
          await prepare();
          notice('Context changed. Review the new preview before sharing.');
          return;
        }
        if (button.hasAttribute('data-handoff-copy')) {
          await navigator.clipboard.writeText(fresh.text);
          notice('Context copied. Paste it into a new conversation in the selected client.');
        } else {
          const url = URL.createObjectURL(
            new Blob([fresh.text], { type: 'text/markdown;charset=utf-8' }),
          );
          const anchor = document.createElement('a');
          anchor.href = url;
          anchor.download = 'agent-hub-handoff.md';
          anchor.click();
          URL.revokeObjectURL(url);
        }
      })().catch((error) => {
        actions.forEach((action) => {
          action.disabled = true;
        });
        output.textContent = error.message;
        notice(error.message, true);
      });
    }),
  );
}
