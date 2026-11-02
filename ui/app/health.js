import { escape, pill } from './html.js';

export function healthPill(name, cached) {
  const result = cached?.report.results.find((r) => r.name === name);
  if (!result) return pill('Not checked');
  if (cached.stale) return pill('Stale', 'warn');
  if (result.status === 'ok' && result.service?.status === 'unavailable')
    return pill(`MCP connected · ${result.service.name} unavailable`, 'warn');
  if (result.status === 'ok' && result.service?.status === 'unknown')
    return pill(`MCP connected · ${result.service.name} unverified`, 'warn');
  return pill(
    { ok: 'Connected', failed: 'Failed', skipped: 'Skipped', cancelled: 'Cancelled' }[
      result.status
    ],
    { ok: 'ok', failed: 'err', skipped: '', cancelled: 'warn' }[result.status],
  );
}

export function doctorResultText(result) {
  return (
    result.error?.message ||
    result.note ||
    {
      ok: 'Initialization and tools/list passed.',
      cancelled: 'Check cancelled before completion.',
      skipped: 'Server was not checked.',
      failed: 'Connection check failed.',
    }[result.status]
  );
}

export function serviceDetails(service) {
  if (!service) return '';
  return `<div class="service-status"><p><b>${escape(service.name)} service</b> ${pill(service.status, service.status === 'ready' ? 'ok' : 'warn')}${service.httpStatus ? ` · HTTP ${service.httpStatus}` : ''}</p><p class="small-note">${escape(service.message)}</p>${service.hint ? `<p class="small-note">${escape(service.hint)}</p>` : ''}</div>`;
}

export function healthDetails(name, cached) {
  const result = cached?.report.results.find((r) => r.name === name);
  return `<div class="card-b"><h3>Last connection check</h3><div class="doctor-status">${healthPill(name, cached)}${result?.tools !== null && result?.tools !== undefined ? pill(`${result.tools} tools`) : ''}${result ? pill(`${result.durationMs} ms`) : ''}</div><p class="small-note">${result ? escape(doctorResultText(result)) : 'Run a check to test this hub launcher.'}</p>${result?.error ? `<p class="small-note">${escape(result.error.hint)}</p>` : ''}${result ? `<p class="small-note">${escape(new Date(result.checkedAt).toLocaleString())}${cached.stale ? ' · Configuration changed. Run a fresh check.' : ''}</p>` : ''}${serviceDetails(result?.service)}<p><button class="btn sm" data-action="doctor" data-name="${escape(name)}">Check this server</button></p></div>`;
}

export function doctorSummary(cached) {
  const summary = cached?.report.summary;
  return `<div class="card doctor-health"><div><h3>MCP connections ${cached?.stale ? pill('Stale', 'warn') : ''}</h3><p>${summary ? `${summary.ok} passed · ${summary.failed} failed · ${summary.skipped} skipped · ${summary.cancelled} cancelled · ${summary.warnings} warnings · ${escape(new Date(cached.report.finishedAt).toLocaleString())}` : 'Connection checks have not been run yet.'}</p></div><button class="btn" data-action="doctor">Check MCP</button></div>`;
}
