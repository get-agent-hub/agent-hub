import type { HealthCheck } from '../configuration/registry.js';
import type { DoctorService } from './types.js';

/** Probe an explicit readiness endpoint independently of MCP, without sending credentials. */
export async function checkService(
  check: HealthCheck | undefined,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<DoctorService | undefined> {
  if (!check || signal?.aborted) return;
  const name = check.name ?? 'Service';
  const unknown = (message: string): DoctorService => ({
    name,
    status: 'unknown',
    message,
    hint: 'The readiness endpoint may be protected, customized or hidden by the ingress. MCP discovery does not verify service API access.',
  });
  let url: URL;
  try {
    url = new URL(check.url);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      /\$\{/.test(url.href)
    )
      throw new Error();
    url.search = '';
    url.hash = '';
  } catch {
    return unknown('The service readiness URL could not be derived safely.');
  }
  const controller = new AbortController();
  const cancel = () => controller.abort();
  const timer = setTimeout(cancel, Math.min(3000, timeoutMs));
  signal?.addEventListener('abort', cancel, { once: true });
  if (signal?.aborted) controller.abort();
  try {
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'manual',
      signal: controller.signal,
    });
    // Status is sufficient; discard bodies, which may contain private application details.
    await response.body?.cancel();
    const httpStatus = response.status;
    if (httpStatus === 200)
      return {
        name,
        status: 'ready',
        httpStatus,
        message: 'The service readiness endpoint responded successfully.',
      };
    if (httpStatus >= 500)
      return {
        name,
        status: 'unavailable',
        httpStatus,
        message: 'The service service is unavailable or not ready.',
        hint: 'If it is intentionally stopped, leave its configuration in place and recheck after starting it. Otherwise check the deployment, database and ingress.',
      };
    return {
      ...unknown('The service readiness endpoint could not confirm availability.'),
      httpStatus,
    };
  } catch (error) {
    if (signal?.aborted) return;
    const code = (error as { cause?: { code?: string } })?.cause?.code;
    if (code === 'ENOTFOUND' || code === 'EAI_AGAIN')
      return {
        name,
        status: 'unavailable',
        message: 'The service hostname could not be resolved (DNS).',
        hint: 'If this deployment is intentionally stopped, keep its configuration and recheck after starting it. Otherwise check the hostname, DNS and VPN.',
      };
    if (code === 'ECONNREFUSED')
      return {
        name,
        status: 'unavailable',
        message: 'The service endpoint refused the connection.',
        hint: 'Start the service or check its port, deployment and ingress, then recheck.',
      };
    if (code && /^(?:CERT_|ERR_TLS_|UNABLE_TO_VERIFY_|DEPTH_ZERO_SELF_SIGNED_CERT)/.test(code))
      return {
        name,
        status: 'unavailable',
        message: 'The service TLS certificate could not be verified.',
        hint: 'Check the endpoint certificate and trust chain, then recheck.',
      };
    if (controller.signal.aborted)
      return {
        name,
        status: 'unavailable',
        message: 'The service readiness endpoint did not respond within the time limit.',
        hint: 'The service may be stopped or unreachable. Start or reconnect it, then recheck.',
      };
    return {
      name,
      status: 'unavailable',
      message: 'The service readiness endpoint could not be reached.',
      hint: 'The service may be stopped, or its network, DNS, VPN or TLS connection may be unavailable. Start or reconnect it, then recheck.',
    };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', cancel);
  }
}
