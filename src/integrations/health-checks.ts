import type { HealthCheck, HubServer } from '../core/registry.js';

/** Compatibility preset; all transport, timeout and error handling lives in the generic probe. */
export function n8nReadiness(env: Record<string, string>): HealthCheck | undefined {
  if (!env.N8N_API_URL) return;
  try {
    const url = new URL(env.N8N_API_URL);
    url.pathname = `${url.pathname.replace(/\/+$/, '')}/healthz/readiness`;
    return { name: 'n8n', url: url.toString() };
  } catch {
    return { name: 'n8n', url: env.N8N_API_URL };
  }
}

export function serviceHealthCheck(
  server: HubServer,
  launchEnv: Record<string, string>,
  vars: Map<string, string>,
): HealthCheck | undefined {
  if (!server.health) return n8nReadiness(launchEnv);
  return {
    name: server.health.name,
    url: server.health.url.replace(
      /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g,
      (_, key: string) => vars.get(key) ?? process.env[key] ?? `\${${key}}`,
    ),
  };
}
