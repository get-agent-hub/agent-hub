import { discoverMemory } from './memory-discovery.js';
import { scanNativeMemory } from './memory-auto-native.js';
import { planAutomaticFacts } from './memory-auto-sync.js';
import { autoJson, autoRow, readAutomation, autoClient } from './memory-auto-config.js';
import { HubError } from './errors.js';
import type { ClientId } from './types.js';

export async function planMemoryOnboarding(
  root: string,
  workspace: string,
  at: string,
  options: { sources?: string[]; client?: ClientId; follow?: boolean } = {},
) {
  if (options.client) autoClient(options.client);
  const discovery = await discoverMemory(root, workspace);
  if (!discovery.project)
    throw new HubError(
      'Register this checkout with memory project register before onboarding its memory.',
    );
  if (
    options.sources &&
    (new Set(options.sources).size !== options.sources.length ||
      options.sources.some((id) => !/^source-[a-f0-9]{24}$/.test(id)))
  )
    throw new HubError('Choose distinct source IDs from memory discover.');
  const selected = options.sources?.length
    ? options.sources.map((id) => {
        const source = discovery.sources.find((item) => item.id === id);
        if (!source)
          throw new HubError('Memory source disappeared or is unknown; run memory discover again.');
        return source;
      })
    : discovery.sources.filter(
        (source) => source.projectId === discovery.project && source.format === 'markdown',
      );
  const candidates = selected.filter(
    (source) => !options.client || source.client === options.client,
  );
  if (!candidates.length)
    throw new HubError(
      'No project-matched Markdown sources. Run memory discover and explicitly select an unresolved source with --source.',
    );
  if (candidates.length > 20)
    throw new HubError('Choose at most 20 native sources in one onboarding plan.');
  if (options.sources?.length && candidates.length !== selected.length)
    throw new HubError('A selected source belongs to a different --client filter.');
  if (candidates.some((source) => source.format !== 'markdown'))
    throw new HubError(
      'Selected memory format is unsupported; no content was imported. Export selected knowledge to Markdown first.',
    );
  if (
    candidates.some(
      (source) =>
        source.project !== null &&
        source.project !== discovery.workspace &&
        source.projectId !== discovery.project,
    )
  )
    throw new HubError(
      'A selected source belongs to another checkout. Onboard that project separately.',
    );
  const scans = await Promise.all(
    candidates.map((source) =>
      scanNativeMemory(root, { client: source.client, directory: source.path }),
    ),
  );
  const { policy, file } = await readAutomation(root, workspace);
  const requests = [];
  if (options.follow) {
    policy.enabled = true;
    policy.clients = [
      ...new Set([...policy.clients, ...candidates.map((source) => source.client)]),
    ].sort();
    for (const source of candidates)
      if (
        !policy.native.some(
          (item) => item.client === source.client && item.directory === source.path,
        )
      )
        policy.native.push({ client: source.client, directory: source.path });
    if (policy.native.length > 20)
      throw new HubError('A project supports up to 20 native memory source directories.');
    const request = autoJson(file, policy);
    if (request) requests.push(request);
  }
  const command = [
    'memory',
    'onboard',
    '--workspace',
    discovery.workspace,
    '--at',
    at,
    ...candidates.flatMap((source) => ['--source', source.id]),
    ...(options.follow ? ['--follow'] : []),
  ];
  return planAutomaticFacts(
    root,
    discovery.workspace,
    scans.flatMap((scan) => scan.facts),
    at,
    {
      manual: true,
      command,
      requests,
      sources: scans.flatMap((scan) => scan.sources),
      rows: [
        ...candidates.map((source) => ({
          path: source.path,
          name: source.id,
          client: source.client,
          action: 'keep' as const,
          note:
            (source.project
              ? 'Project association: '
              : 'Explicitly assign this unresolved source to: ') +
            discovery.workspace +
            (options.follow
              ? '. Follow-up imports enabled; existing lifecycle handlers can activate for this project. Hook installation is separate.'
              : '. One-time import; source directory is not attached for future scans.'),
        })),
        ...requests.map((request) => autoRow(request, 'native memory follow-up policy')),
        ...scans.flatMap((scan) =>
          scan.skipped.map((item) => ({
            path: item.path,
            name: 'native source notice',
            client: 'memory',
            action: 'skip' as const,
            note: item.reason,
          })),
        ),
        ...scans.flatMap((scan) =>
          scan.notices.map((item) => ({
            path: item.path,
            name: 'native index navigation',
            client: 'memory',
            action: 'keep' as const,
            note: item.reason,
          })),
        ),
      ],
    },
  );
}
