import { escape } from '../shared/html.js';

export function setupTelemetryUi({ api, getState, load, notice }) {
  const privacy = () => navigator.doNotTrack === '1' || navigator.globalPrivacyControl === true;
  let opened = false;
  const track = (event) => {
    if (privacy() || getState()?.telemetry?.enabled !== true) return;
    void api('/api/telemetry/event', { event }).catch(() => undefined);
  };
  const initialize = () => {
    if (!opened && getState()?.telemetry) {
      opened = true;
      track('app_opened');
    }
  };
  document.addEventListener('change', (event) => {
    if (event.target.id !== 'usage-analytics') return;
    const input = event.target;
    input.disabled = true;
    void api('/api/telemetry/settings', { enabled: input.checked })
      .then(async () => {
        await load();
        notice(input.checked ? 'Usage analytics enabled.' : 'Usage analytics disabled.');
      })
      .catch((error) => {
        input.checked = !input.checked;
        notice(error.message, true);
      })
      .finally(() => {
        input.disabled = false;
      });
  });
  return {
    track,
    initialize,
    view() {
      const status = getState()?.telemetry;
      return `<section class="card section-gap"><div class="card-h"><h3>Usage analytics</h3></div><div class="card-b"><label><input type="checkbox" id="usage-analytics" ${status?.enabled && !privacy() ? 'checked' : ''} ${!status || status.blocked || privacy() ? 'disabled' : ''}> Share basic usage statistics</label><p class="small-note">On by default. Sends named actions and the app version with a random installation ID to ${escape(status?.destination || 'the configured relay')}, then PostHog. No chat text, search queries, project names, file paths or client configuration. No screen recording.</p><p class="small-note">Turn this off here or run <code>ahub telemetry off</code>. <code>DO_NOT_TRACK=1</code> disables collection without changing saved preferences.${privacy() || status?.blocked ? ' Collection is blocked by a privacy or environment setting.' : ''}</p></div></section>`;
    },
  };
}
