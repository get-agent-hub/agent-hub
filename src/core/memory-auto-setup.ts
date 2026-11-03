import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDocument, isSeq, type YAMLSeq } from 'yaml';
import { inspectArtifact, containsPath, type ArtifactSnapshot } from './artifacts.js';
import { readOptionalText } from './file-store.js';
import { managedPlan, type ArtifactRequest, type ManagedRow } from './managed-plan.js';
import { clientPaths } from './paths.js';
import { readSettings, dshProfile } from './settings.js';
import { memoryFile } from './memory-store.js';
import { readAutomation, autoClient, autoJson, autoRow } from './memory-auto-config.js';
import { hubCommand } from './shell.js';
import { hash, isRecord, stableStringify } from './values.js';
import { HubError } from './errors.js';

interface HookOwnership {
  version: 1;
  entries: { path: string; event: string; hash: string }[];
  dsh?: { path: string; hash: string }[];
}
const events = ['SessionStart', 'UserPromptSubmit', 'Stop'];

export async function planAutomationSetup(
  root: string,
  workspace: string,
  clientValue: unknown,
  options: {
    nativeDir?: string;
    hookFile?: string;
    dshPatch?: string;
    node?: string;
    cli?: string;
  } = {},
) {
  const client = autoClient(clientValue);
  const { policy, file: policyFile } = await readAutomation(root, workspace);
  const settings = await readSettings(root);
  const hookFile = path.resolve(
    options.hookFile ??
      (client === 'claude-code'
        ? path.join(clientPaths.claudeHome(), 'settings.json')
        : client === 'codex'
          ? path.join(clientPaths.codexHome(), 'hooks.json')
          : path.join(clientPaths.dshHome(), 'hooks', 'agent-hub-memory.json')),
  );
  const before = await inspectArtifact(hookFile);
  if (!['file', 'missing'].includes(before.kind))
    throw new HubError(
      'Hook configuration must be a regular file; preserve and resolve its binding first.',
    );
  const text = await readOptionalText(hookFile);
  let config: Record<string, unknown>;
  try {
    const value: unknown = JSON.parse(text ?? '{}');
    if (!isRecord(value) || (value.hooks !== undefined && !isRecord(value.hooks)))
      throw new Error();
    config = value;
  } catch {
    throw new HubError('Cannot parse lifecycle hook configuration safely.');
  }
  const ownership = await memoryFile(root, path.join(root, 'memory', 'automation-hooks.json'));
  let state: HookOwnership;
  try {
    state = JSON.parse(ownership.text ?? '{"version":1,"entries":[]}');
    if (
      state.version !== 1 ||
      !Array.isArray(state.entries) ||
      state.entries.some(
        (entry) =>
          !path.isAbsolute(entry.path) ||
          !events.includes(entry.event) ||
          !/^[a-f0-9]{64}$/.test(entry.hash),
      ) ||
      new Set(state.entries.map((entry) => `${entry.path}:${entry.event}`)).size !==
        state.entries.length
    )
      throw new Error();
  } catch {
    throw new HubError('Invalid automation hook ownership.');
  }
  const rows: ManagedRow[] = [];
  const requests: ArtifactRequest[] = [];
  const sources: ArtifactSnapshot[] = [];
  const command = hubCommand(
    {
      root,
      node: options.node ?? process.execPath,
      cli: options.cli ?? fileURLToPath(new URL('../../dist/cli.js', import.meta.url)),
    },
    ['memory', 'auto', 'hook', '--client', client],
  );
  const hooks = (config.hooks ?? {}) as Record<string, unknown>;
  for (const event of events) {
    const value = hooks[event] ?? [];
    if (!Array.isArray(value)) throw new HubError('Hook matcher groups must be arrays.');
    let groups: unknown[] = value;
    const previous = state.entries.find(
      (entry) => entry.path === hookFile && entry.event === event,
    );
    if (
      !previous &&
      groups.some(
        (group) =>
          isRecord(group) &&
          Array.isArray(group.hooks) &&
          group.hooks.some((handler) => isRecord(handler) && handler.command === command),
      )
    )
      throw new HubError(
        'An Agent Hub lifecycle hook exists without ownership. Preserve it and review before setup.',
      );
    if (previous) {
      const matches = groups.filter((group) => hash(stableStringify(group)) === previous.hash);
      if (matches.length !== 1)
        throw new HubError(
          'A managed lifecycle hook was edited, removed or duplicated; preserve it and review before setup.',
        );
      groups = groups.filter((group) => hash(stableStringify(group)) !== previous.hash);
    }
    if (client === 'dsh') {
      if (previous) hooks[event] = groups;
      state.entries = state.entries.filter(
        (entry) => entry.path !== hookFile || entry.event !== event,
      );
      continue;
    }
    const group = { hooks: [{ type: 'command', command, timeout: 30 }] };
    hooks[event] = [...groups, group];
    state.entries = state.entries.filter(
      (entry) => entry.path !== hookFile || entry.event !== event,
    );
    state.entries.push({ path: hookFile, event, hash: hash(stableStringify(group)) });
  }
  if (client !== 'dsh' || text !== null) config.hooks = hooks;
  const content = JSON.stringify(config, null, 2) + '\n';
  if (text !== content && (client !== 'dsh' || text !== null))
    requests.push({
      before,
      client,
      value: { kind: 'file', content, mode: before.kind === 'file' ? before.mode : 0o600 },
    });
  else sources.push(before);
  if (client === 'dsh') {
    const patch = path.resolve(
      options.dshPatch ??
        path.join(clientPaths.dshHome(), 'profiles', dshProfile(settings), 'cordis.patch.yml'),
    );
    const patchBefore = await inspectArtifact(patch);
    if (!['file', 'missing'].includes(patchBefore.kind))
      throw new HubError('DSH profile patch must be a regular file.');
    const patchText = await readOptionalText(patch);
    const doc = parseDocument(patchText ?? '[]');
    if (doc.errors.length || !isSeq(doc.contents))
      throw new HubError('DSH profile patch must be a YAML plugin sequence.');
    const id = 'agent-hub-memory-hooks';
    const sequence = doc.contents as YAMLSeq;
    const values = sequence.toJSON() as unknown[];
    const indexes = values.flatMap((value, index) =>
      isRecord(value) &&
      Array.isArray(value.insert) &&
      value.insert.some((entry) => isRecord(entry) && entry.id === id)
        ? [index]
        : [],
    );
    if (indexes.length > 1)
      throw new HubError('Duplicate Agent Hub memory hook plugins in the DSH profile.');
    const existing = indexes[0];
    const adapter = new URL('../integrations/dsh-memory.js', import.meta.url);
    const adapterSnapshot = await inspectArtifact(fileURLToPath(adapter));
    if (adapterSnapshot.kind !== 'file')
      throw new HubError(
        'The installed Hub package is missing its native DSH memory adapter. Rebuild or reinstall it.',
      );
    sources.push(adapterSnapshot);
    const descriptor = {
      name: adapter.href,
      id,
      config: { root },
    };
    const wrapper = { insert: [descriptor] };
    const prior = state.dsh?.find((entry) => entry.path === patch);
    if (existing !== undefined) {
      if (!prior || prior.hash !== hash(stableStringify(values[existing])))
        throw new HubError('DSH memory hook plugin has unknown or modified ownership.');
      sequence.set(existing, doc.createNode(wrapper));
    } else if (prior) throw new HubError('A previously managed DSH hook plugin was removed.');
    else sequence.add(doc.createNode(wrapper));
    state.dsh = [
      ...(state.dsh ?? []).filter((entry) => entry.path !== patch),
      { path: patch, hash: hash(stableStringify(wrapper)) },
    ];
    const next = doc.toString();
    if (next !== patchText)
      requests.push({
        before: patchBefore,
        client,
        value: {
          kind: 'file',
          content: next,
          mode: patchBefore.kind === 'file' ? patchBefore.mode : 0o600,
        },
      });
    else sources.push(patchBefore);
  }
  policy.enabled = true;
  policy.clients = [...new Set([...policy.clients, client])].sort();
  state.entries.sort((a, b) => `${a.path}:${a.event}`.localeCompare(`${b.path}:${b.event}`));
  state.dsh?.sort((a, b) => a.path.localeCompare(b.path));
  let nativeDir: string | undefined;
  if (options.nativeDir) {
    nativeDir = path.resolve(options.nativeDir);
    const native = await inspectArtifact(nativeDir);
    if (!['missing', 'directory'].includes(native.kind))
      throw new HubError('Native memory must use a real directory.');
    const hub = await fs.realpath(root);
    if (containsPath(hub, native.physicalPath) || containsPath(native.physicalPath, hub))
      throw new HubError('Native memory and Hub must not overlap.');
    nativeDir = native.physicalPath;
    if (!policy.native.some((source) => source.client === client && source.directory === nativeDir))
      policy.native.push({ client, directory: nativeDir });
    sources.push(native);
  }
  if (policy.native.length > 20)
    throw new HubError('A project supports up to 20 native memory source directories.');
  for (const [file, value] of [
    [policyFile, policy],
    [ownership, state],
  ] as const) {
    const request = autoJson(file, value);
    if (request) requests.push(request);
    else sources.push(file.snapshot);
  }
  rows.push(
    ...requests.map((request) =>
      autoRow(
        request,
        request.before.path === hookFile ? 'project-gated lifecycle hooks' : 'automation setup',
      ),
    ),
  );
  return managedPlan(
    {
      root,
      requests,
      rows,
      sources,
      command: [
        'memory',
        'auto',
        'enable',
        '--workspace',
        workspace,
        '--client',
        client,
        ...(nativeDir ? ['--native-dir', nativeDir] : []),
      ],
    },
    { policy, client },
  );
}

export async function planAutomationDisable(root: string, workspace: string) {
  const { policy, file } = await readAutomation(root, workspace);
  policy.enabled = false;
  const request = autoJson(file, policy);
  return managedPlan({
    root,
    requests: request ? [request] : [],
    rows: request ? [autoRow(request, 'disable project automation')] : [],
    sources: [],
    command: ['memory', 'auto', 'disable', '--workspace', workspace],
  });
}
