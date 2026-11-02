import { runDoctor } from '../core/doctor.js';
import { c, printJson, table } from '../core/output.js';
import type { ClientId } from '../core/types.js';

export async function doctorCommand(
  name: string | undefined,
  opts: { timeout: string; client?: string; json?: boolean },
) {
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  try {
    const report = await runDoctor(
      { name, client: opts.client as ClientId | undefined, timeout: Number(opts.timeout) },
      undefined,
      {
        signal: controller.signal,
        onResult: opts.json
          ? undefined
          : (r) =>
              console.error(
                `  ${r.status.padEnd(9)} ${r.name}${r.tools !== null ? ` · ${r.tools} tools` : ''} · ${r.durationMs} ms`,
              ),
      },
    );
    if (opts.json) printJson(report);
    else {
      console.log(
        table(
          ['server', 'status', 'tools', 'time', 'details'],
          report.results.map((r) => [
            r.name,
            r.status,
            r.tools === null ? '—' : String(r.tools),
            `${r.durationMs} ms`,
            r.error
              ? `${r.error.message} ${r.error.hint}`
              : (r.note ??
                (r.status === 'ok'
                  ? 'Connected; tools/list passed.'
                  : r.status === 'cancelled'
                    ? 'Check cancelled before completion.'
                    : 'Server was not checked.')),
          ]),
        ),
      );
      const services = report.results.filter((r) => r.service);
      if (services.length)
        console.log(
          '\n' +
            table(
              ['server / service', 'status', 'details'],
              services.map((r) => [
                r.name + ' / ' + r.service!.name,
                r.service!.status,
                `${r.service!.message}${r.service!.httpStatus ? ` HTTP ${r.service!.httpStatus}.` : ''}${r.service!.hint ? ` ${r.service!.hint}` : ''}`,
              ]),
            ),
        );
      const attention = report.checks.filter((check) => check.status !== 'ok');
      if (attention.length)
        console.log(
          '\n' +
            table(
              ['local check', 'status', 'details'],
              attention.map((check) => [check.name, check.status, check.message]),
            ),
        );
      console.log(
        `\n${report.summary.ok} passed · ${report.summary.failed} failed · ${report.summary.skipped} skipped · ${report.summary.cancelled} cancelled · ${report.summary.warnings} warnings`,
      );
      console.log(
        c.dim(
          'MCP connection, tool discovery and listed readiness endpoints only; tools and provider API operations were not tested.',
        ),
      );
      if (report.saveWarning) console.log(c.yellow(report.saveWarning));
    }
    if (report.summary.cancelled) process.exitCode = 130;
    else if (report.summary.failed || report.checks.some((r) => r.status === 'failed'))
      process.exitCode = 1;
  } finally {
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
  }
}
