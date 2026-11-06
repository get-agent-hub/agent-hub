export function setupHistoryStartupUi({ api, refresh, notice }) {
  document.addEventListener('change', (event) => {
    if (event.target.id !== 'history-login') return;
    const checkbox = event.target;
    checkbox.disabled = true;
    void (async () => {
      const plan = await api('/api/history/startup/preview', { enabled: checkbox.checked });
      if (plan.blocked)
        throw new Error(
          'A startup file was edited or belongs to another setup. It was preserved; review its configuration before retrying.',
        );
      if (
        !window.confirm(
          `Change login startup?\n\n${plan.rows.map((row) => `${row.action}: ${row.path}`).join('\n')}\n\nTakes effect at your next sign-in. Current background refresh is controlled separately. No system service or administrator access is needed.`,
        )
      )
        return;
      await api('/api/history/startup/apply', { id: plan.id, revision: plan.revision });
      notice('Login startup updated. The change takes effect at your next sign-in.');
    })()
      .catch((error) => notice(error.message, true))
      .finally(() => {
        checkbox.disabled = false;
        void refresh();
      });
  });
}
