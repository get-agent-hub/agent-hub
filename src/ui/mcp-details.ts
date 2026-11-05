import { adapters } from '../adapters/index.js';
import type { ClientAdapter, ClientId } from '../contracts/clients.js';
import {
  envPath,
  readRegistry,
  validServerName,
  inferTransport,
  type HubServer,
} from '../core/configuration/registry.js';
import { readEnvFile } from '../core/configuration/env.js';
import { normalize, isHubProjection } from '../core/mcp/importer.js';
import { isCurrentProjection, semantic } from '../core/mcp/sync.js';
import { hubRoot, tildify } from '../shared/paths.js';
import { displayServer } from './data.js';

type Copy = {
  client: 'hub' | ClientId;
  label: string;
  path: string;
  server: HubServer;
  managed: boolean;
  ambiguous: boolean;
  hubLauncher?: boolean;
};
const fields = ['transport', 'command', 'args', 'url', 'cwd', 'env', 'headers'] as const;

/** Read only a registered server name. Private values are compared internally, never returned. */
export async function mcpDetails(name: string, sources: ClientAdapter[] = adapters) {
  if (!validServerName(name)) return null;
  const root = hubRoot();
  const [registry, env] = await Promise.all([readRegistry(), readEnvFile(envPath())]);
  const hub = Object.hasOwn(registry.servers, name) ? registry.servers[name] : undefined;
  const copies: Copy[] = hub
    ? [
        {
          client: 'hub',
          label: 'Hub',
          path: tildify(root),
          server: hub,
          managed: true,
          ambiguous: false,
        },
      ]
    : [];
  const native = await Promise.all(
    sources.map(async (adapter) => {
      if (!(await adapter.detect()).installed) return [];
      const records = (await adapter.readMcpRaw()).filter((row) => row.name === name);
      return Promise.all(
        records.map(async (row) => ({
          client: adapter.id,
          label: adapter.label,
          path: tildify(row.source),
          server: normalize(adapter.id, row.raw),
          managed: await isCurrentProjection(row.raw, name, root),
          hubLauncher: isHubProjection(row.raw),
          ambiguous: records.length > 1,
        })),
      );
    }),
  );
  copies.push(...native.flat());
  if (!copies.length) return null;
  const definitions = copies.map((copy) => (copy.managed && hub ? hub : copy.server));
  const effective = definitions.map((server) =>
    Object.fromEntries(
      fields.map((field) => [
        field,
        semantic(
          field === 'transport'
            ? { transport: inferTransport(server) }
            : {
                transport: 'stdio',
                ...(server[field] === undefined ? {} : { [field]: server[field] }),
              },
          env,
        ),
      ]),
    ),
  );
  const signatures = definitions.map((server) => semantic(server, env));
  const differingFields: string[] = fields.filter(
    (field) => new Set(effective.map((value) => value[field])).size > 1,
  );
  if (!differingFields.length && new Set(signatures).size > 1) differingFields.push('other');
  return {
    name,
    differingFields,
    copies: copies.map((copy, index) => ({
      client: copy.client,
      label: copy.label,
      path: copy.path,
      managed: copy.managed,
      hubLauncher: copy.hubLauncher === true,
      ambiguous: copy.ambiguous,
      matchesHub: hub ? signatures[index] === signatures[0] : null,
      differences: hub
        ? fields.filter((field) => effective[index]![field] !== effective[0]![field]).length
          ? fields.filter((field) => effective[index]![field] !== effective[0]![field])
          : signatures[index] !== signatures[0]
            ? ['other']
            : []
        : differingFields,
      config: displayServer(name, copy.managed && hub ? hub : copy.server),
    })),
  };
}
