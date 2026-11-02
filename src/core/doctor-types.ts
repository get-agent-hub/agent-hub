export type DoctorPhase = 'preflight' | 'initialize' | 'tools/list';
export type FailureKind =
  | 'missing-env'
  | 'not-found'
  | 'permission'
  | 'auth'
  | 'network'
  | 'unavailable'
  | 'timeout'
  | 'protocol'
  | 'process-exit'
  | 'package-cache'
  | 'config';
export interface DoctorFailure {
  kind: FailureKind;
  message: string;
  hint: string;
}
export interface DoctorService {
  name: string;
  status: 'ready' | 'unavailable' | 'unknown';
  message: string;
  hint?: string;
  httpStatus?: number;
}
export interface ProbeResult {
  status: 'ok' | 'failed' | 'skipped' | 'cancelled';
  phase: DoctorPhase;
  tools: number | null;
  pages?: number;
  error?: DoctorFailure;
  note?: string;
  service?: DoctorService;
}
export interface DoctorResult extends ProbeResult {
  name: string;
  durationMs: number;
  checkedAt: string;
}
export interface DoctorCheck {
  name: string;
  status: 'ok' | 'warn' | 'failed';
  message: string;
}
export interface DoctorReport {
  version: 1;
  revision: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  scope: { name?: string; client?: string };
  checks: DoctorCheck[];
  results: DoctorResult[];
  summary: { ok: number; failed: number; skipped: number; cancelled: number; warnings: number };
  command: string;
  saveWarning?: string;
}

/** Fixed descriptions only: server stderr/errors can contain tokens, URLs and session strings. */
export function failure(kind: FailureKind): DoctorFailure {
  const descriptions: Record<FailureKind, [string, string]> = {
    'missing-env': [
      'Required environment variables are missing.',
      'Add the referenced variables to the hub .env, then retry.',
    ],
    'not-found': [
      'The server executable or entry point was not found.',
      'Check the command and install the required runtime or package.',
    ],
    permission: [
      'The process could not start or access a required file.',
      'Check executable permissions and access to the configured working directory.',
    ],
    auth: [
      'The server reported an authentication problem.',
      'Check or renew this server’s credentials, then retry.',
    ],
    network: [
      'The server could not reach a required service.',
      'Check the connection, VPN, proxy and server availability.',
    ],
    unavailable: [
      'A required service is temporarily unavailable.',
      'If the service is intentionally stopped, start it when needed and retry. Otherwise check its deployment and ingress.',
    ],
    timeout: [
      'The check exceeded its time limit.',
      'Check the connection or retry with a longer timeout if startup needs more time.',
    ],
    protocol: [
      'The server returned an invalid or unsupported MCP response.',
      'Check that the configured command starts an MCP stdio server.',
    ],
    'process-exit': [
      'The server exited before the check completed.',
      'Check its startup configuration and dependencies.',
    ],
    'package-cache': [
      'The package runner could not update its local cache.',
      'Stop competing package launches, back up the affected npx cache entry and reinstall it. This happens before connecting to the service.',
    ],
    config: [
      'The server definition is incomplete or invalid.',
      'Review its command, transport and working directory in the hub registry.',
    ],
  };
  return { kind, message: descriptions[kind][0], hint: descriptions[kind][1] };
}

export function classifyFailure(value: unknown, stderr = ''): DoctorFailure {
  const message = `${value instanceof Error ? value.message : ''}\n${stderr}`.slice(-16384);
  if (
    /\bENOTEMPTY\b/i.test(message) &&
    /\brename\b/i.test(message) &&
    /npm|npx|node_modules/i.test(message)
  )
    return failure('package-cache');
  if (/missing env var/i.test(message)) return failure('missing-env');
  if (
    /ENOENT|cannot find module|module not found|no such file|command not found|executable.*not found/i.test(
      message,
    )
  )
    return failure('not-found');
  if (/EACCES|EPERM|permission denied|operation not permitted/i.test(message))
    return failure('permission');
  if (
    /\b(401|403)\b|unauthorized|unauthenticated|\binvalid[\s_-]+(token|session|api.?key|credential)|\b(token|session|credential)[\s_-]+(expired|revoked|invalid)|\bauth(entication|orization|_key|key)?[\s:_-]*(fail\w*|error|required|invalid|unregistered|revoked)|access denied/i.test(
      message,
    )
  )
    return failure('auth');
  if (
    /(?:HTTP(?:\/[\d.]+)?|status(?: code)?|response(?: status)?)[\s:"=]+(?:502|503|504)\b|\b(?:502 Bad Gateway|503 Service Unavailable|504 Gateway Timeout)\b/i.test(
      message,
    )
  )
    return failure('unavailable');
  if (
    /ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|EHOSTUNREACH|ENETUNREACH|connect.*(fail|error)|fetch failed|certificate|SSL|TLS/i.test(
      message,
    )
  )
    return failure('network');
  if (/timeout|timed out|ETIMEDOUT/i.test(message)) return failure('timeout');
  if (
    /JSON|parse|protocol|schema|invalid.{0,12}(response|message)|unsupported|pagination|duplicate tool/i.test(
      message,
    )
  )
    return failure('protocol');
  return failure('process-exit');
}
