import { escape, pill } from '../shared/html.js';
import { doctorResultText, serviceDetails } from '../entities/health.js';
export function setupDoctorUi({ api, load, notice, getState }) {
  const $ = (s) => document.querySelector(s);
  let doctorJob,
    doctorVersion = 0,
    doctorTimer;
  function setDoctorBusy(busy) {
    document
      .querySelectorAll('.doctor-options select, .doctor-options input')
      .forEach((el) => (el.disabled = busy));
    $('#doctor-run').disabled = busy;
    $('#doctor-cancel').hidden = !busy;
  }

  function renderDoctor(job) {
    const report = job.report;
    const results = report?.results || job.results || [];
    const names = $('#doctor-server').value
      ? [$('#doctor-server').value]
      : getState().servers.map((s) => s.name);
    const byName = new Map(results.map((r) => [r.name, r]));
    const running = job.state === 'running';
    const rows = names.map((name) => ({ name, result: byName.get(name) }));
    const tones = { ok: 'ok', failed: 'err', skipped: '', cancelled: 'warn' };
    const checks = report?.checks.filter((c) => c.status !== 'ok') || [];
    $('#doctor-results').innerHTML =
      `${job.error ? `<div class="import-error">${escape(job.error)}</div>` : ''}<div class="card table-wrap doctor-results"><table class="table"><thead><tr><th>Server</th><th>Status</th><th>Tools</th><th>Time</th><th>Result</th></tr></thead><tbody>${rows.map(({ name, result: r }) => `<tr><td><b>${escape(name)}</b></td><td>${r ? pill(r.status, tones[r.status]) : pill(running ? 'Pending' : 'Not checked')}</td><td>${r?.tools === null || r?.tools === undefined ? '—' : r.tools}</td><td class="mono duration">${r ? `${r.durationMs} ms` : '—'}</td><td class="details">${r ? `<span>${escape(doctorResultText(r))}</span>${r.error ? `<span class="hint">${escape(r.error.hint)} · ${escape(r.phase)}</span>` : ''}${serviceDetails(r.service)}` : running ? 'Waiting for this server…' : 'Run checks to get a result.'}</td></tr>`).join('')}</tbody></table></div>${checks.length ? `<div class="section-title">Local checks</div><div class="card"><ul class="list">${checks.map((c) => `<li>${pill(c.status, c.status === 'failed' ? 'err' : 'warn')}<div class="copy"><b>${escape(c.name)}</b><div class="sub">${escape(c.message)}</div></div></li>`).join('')}</ul></div>` : ''}${report?.saveWarning ? `<p class="small-note">${escape(report.saveWarning)}</p>` : ''}`;
    $('#doctor-summary').classList.toggle('doctor-running', running);
    $('#doctor-summary').textContent = running
      ? `${results.length} of ${names.length} completed…`
      : report
        ? `${report.summary.ok} passed · ${report.summary.failed} failed · ${report.summary.skipped} skipped · ${report.summary.cancelled} cancelled · ${report.summary.warnings} warnings`
        : job.error
          ? 'Check could not finish'
          : 'Ready to check';
    $('#doctor-copy').disabled = !report?.command;
    setDoctorBusy(running);
  }

  async function pollDoctor(id, version) {
    if (version !== doctorVersion || !$('#doctor-dialog').open) return;
    try {
      const job = await api(`/api/doctor/${id}`);
      if (version !== doctorVersion) return;
      doctorJob = job;
      renderDoctor(job);
      if (job.state === 'running') doctorTimer = setTimeout(() => pollDoctor(id, version), 800);
      else await load();
    } catch (error) {
      if (version !== doctorVersion) return;
      $('#doctor-results').innerHTML =
        `<div class="import-error">${escape(error.message)}</div><p><button class="btn" data-action="resume-doctor">Reconnect to check</button></p>`;
      $('#doctor-summary').textContent = 'Connection to check interrupted';
    }
  }

  async function startDoctor() {
    if (doctorJob?.state === 'running') return;
    const timeout = Number($('#doctor-timeout').value);
    if (!Number.isFinite(timeout) || timeout < 0.1 || timeout > 120) {
      $('#doctor-summary').textContent = 'Timeout must be 0.1–120 seconds.';
      return;
    }
    const version = ++doctorVersion;
    clearTimeout(doctorTimer);
    setDoctorBusy(true);
    $('#doctor-summary').textContent = 'Starting checks…';
    try {
      const job = await api('/api/doctor/run', {
        name: $('#doctor-server').value || undefined,
        client: $('#doctor-client').value || undefined,
        timeout,
      });
      if (version !== doctorVersion) {
        await api('/api/doctor/cancel', { id: job.id });
        return;
      }
      doctorJob = job;
      renderDoctor(job);
      pollDoctor(job.id, version);
    } catch (error) {
      if (version !== doctorVersion) return;
      setDoctorBusy(false);
      $('#doctor-results').innerHTML = `<div class="import-error">${escape(error.message)}</div>`;
      $('#doctor-summary').textContent = 'Unable to start checks';
    }
  }

  async function cancelDoctor(close = false) {
    clearTimeout(doctorTimer);
    if (doctorJob?.state === 'running') {
      try {
        await api('/api/doctor/cancel', { id: doctorJob.id });
      } catch (error) {
        notice(error.message, true);
        if (!close) return;
      }
    }
    if (close) {
      ++doctorVersion;
      $('#doctor-dialog').close();
    } else if (doctorJob?.id) pollDoctor(doctorJob.id, doctorVersion);
  }

  function openDoctor(name) {
    $('#doctor-server').innerHTML = `<option value="">All hub servers</option>${getState()
      .servers.map((s) => `<option value="${escape(s.name)}">${escape(s.name)}</option>`)
      .join('')}`;
    $('#doctor-server').value = name || '';
    doctorJob = undefined;
    $('#doctor-dialog').showModal();
    renderDoctor({ state: 'ready', results: [] });
    startDoctor();
  }

  $('#doctor-dialog').addEventListener('cancel', (event) => {
    event.preventDefault();
    cancelDoctor(true);
  });

  document.addEventListener('click', (event) => {
    const b = event.target.closest('[data-action]');
    if (!b) return;
    const action = b.dataset.action;
    if (action === 'doctor') openDoctor(b.dataset.name);
    if (action === 'run-doctor') startDoctor();
    if (action === 'cancel-doctor') cancelDoctor();
    if (action === 'close-doctor') cancelDoctor(true);
    if (action === 'resume-doctor' && doctorJob?.id) pollDoctor(doctorJob.id, doctorVersion);
    if (action === 'copy-doctor-command' && doctorJob?.report?.command)
      navigator.clipboard
        .writeText(doctorJob.report.command)
        .then(() => notice('Check command copied.'))
        .catch(() => notice('Unable to access clipboard.', true));
  });
}
