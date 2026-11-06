import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { inspectArtifact } from '../../shared/artifacts.js';
import { HubError } from '../../shared/errors.js';
import { isAbsoluteLocalPath } from '../../shared/paths.js';
import {
  applyManagedPlan,
  managedPlan,
  type ArtifactRequest,
  type ManagedRow,
} from '../recovery/managed-plan.js';
import { backgroundBinding, readBackgroundPolicy } from './background-state.js';
import { ownedHistoryPath } from './storage.js';
import {
  historyStartupContext,
  startupDefinition,
  type HistoryStartupContext,
  type StartupFile,
} from './startup-definition.js';

const fileSchema = z.discriminatedUnion('kind', [
  z.object({ file: z.string(), kind: z.literal('file'), content: z.string().max(32768) }),
  z.object({ file: z.string(), kind: z.literal('symlink'), target: z.string() }),
]);
const manifestSchema = z.object({
  version: z.literal(1),
  root: z.string(),
  binding: z.string(),
  platform: z.string(),
  node: z.string().refine(isAbsoluteLocalPath),
  worker: z.string().refine(isAbsoluteLocalPath),
  files: z.array(fileSchema).min(1).max(2),
});

async function startupManifest(root: string) {
  const file = await ownedHistoryPath(root, 'startup.json');
  const before = await inspectArtifact(file);
  if (before.kind === 'missing') return { before, manifest: null };
  try {
    if (before.kind !== 'file' || (await fs.stat(file)).size > 65536) throw new Error();
    const manifest = manifestSchema.parse(JSON.parse(await fs.readFile(file, 'utf8')));
    if (manifest.root !== path.resolve(root)) throw new Error();
    return { before, manifest };
  } catch {
    throw new HubError('Login startup ownership is invalid. Preserve its files before recovery.');
  }
}
async function matches(file: StartupFile) {
  const current = await inspectArtifact(file.file);
  const same =
    file.kind === 'symlink'
      ? current.kind === 'symlink' && current.target === file.target
      : current.kind === 'file' &&
        current.mode === 0o600 &&
        (await fs.stat(file.file)).size <= 32768 &&
        (await fs.readFile(file.file, 'utf8')) === file.content;
  return { current, same };
}
function verifyPaths(
  root: string,
  binding: string,
  files: StartupFile[],
  context: HistoryStartupContext,
) {
  const expected = startupDefinition(root, binding, context).files.map((file) => file.file);
  if (
    files.length !== expected.length ||
    files.some((file, index) => file.file !== expected[index])
  )
    throw new HubError(
      'Login startup belongs to a different user configuration. Review it in its original environment.',
    );
}
export async function historyStartupStatus(root: string, context = historyStartupContext()) {
  const supported = ['darwin', 'linux'].includes(context.platform);
  if (!supported) return { supported, installed: false, state: 'unsupported' };
  try {
    const { manifest } = await startupManifest(root);
    if (!manifest) return { supported, installed: false, state: 'off' };
    verifyPaths(root, manifest.binding, manifest.files, context);
    const intact = (await Promise.all(manifest.files.map(matches))).every((result) => result.same);
    let binding = false;
    try {
      binding = manifest.binding === (await backgroundBinding(root));
    } catch {
      /* Missing Hub cannot resume. */
    }
    let runtime = true;
    try {
      await fs.access(manifest.node, fs.constants.X_OK);
      runtime = (await fs.stat(manifest.worker)).isFile();
    } catch {
      runtime = false;
    }
    return {
      supported,
      installed: true,
      state: !intact || !runtime ? 'needs-review' : !binding ? 'hub-changed' : 'installed',
      files: manifest.files.map((file) => file.file),
    };
  } catch {
    return { supported, installed: false, state: 'needs-review' };
  }
}

export async function planHistoryStartup(
  root: string,
  enabled: boolean,
  context = historyStartupContext(),
) {
  root = path.resolve(root);
  const { before, manifest } = await startupManifest(root);
  const policy = await readBackgroundPolicy(root);
  const binding = policy?.binding ?? manifest?.binding;
  if (!binding || (enabled && (!policy?.enabled || binding !== (await backgroundBinding(root)))))
    throw new HubError(
      'Enable selected-source background updates before setting up login startup.',
    );
  const definition = startupDefinition(root, binding, context);
  if (enabled) {
    await fs.access(context.node, fs.constants.X_OK);
    if (!(await fs.stat(context.worker)).isFile())
      throw new HubError('Reinstall Hub before enabling login startup.');
  }
  if (manifest) verifyPaths(root, manifest.binding, manifest.files, context);
  const requests: ArtifactRequest[] = [];
  const rows: ManagedRow[] = [];
  for (const [index, desired] of definition.files.entries()) {
    const previous = manifest?.files[index];
    const { current, same } = await matches(previous ?? desired);
    const conflict = current.kind !== 'missing' && (!previous || !same);
    const keep = enabled ? (await matches(desired)).same : current.kind === 'missing';
    rows.push({
      path: current.path,
      client: 'hub',
      name: 'Login startup',
      action: conflict
        ? 'conflict'
        : keep
          ? 'keep'
          : enabled
            ? current.kind === 'missing'
              ? 'add'
              : 'replace'
            : 'remove',
      note: conflict
        ? 'An unowned or edited startup file is preserved.'
        : 'Takes effect at the next user login; current refresh is controlled separately.',
    });
    if (!conflict && !keep)
      requests.push({
        before: current,
        client: 'hub',
        value: !enabled
          ? { kind: 'missing' }
          : desired.kind === 'symlink'
            ? { kind: 'symlink', target: desired.target }
            : { kind: 'file', content: desired.content, mode: 0o600 },
      });
  }
  const nextManifest =
    JSON.stringify({
      version: 1,
      root,
      binding,
      platform: context.platform,
      node: context.node,
      worker: context.worker,
      files: definition.files,
    }) + '\n';
  if (
    enabled
      ? before.kind !== 'file' || (await fs.readFile(before.path, 'utf8')) !== nextManifest
      : before.kind !== 'missing'
  )
    requests.push({
      before,
      client: 'hub',
      value: enabled
        ? {
            kind: 'file',
            mode: 0o600,
            content: nextManifest,
          }
        : { kind: 'missing' },
    });
  const sources = [await inspectArtifact(await ownedHistoryPath(root, 'background-policy.json'))];
  if (enabled) sources.push(await inspectArtifact(context.worker));
  const plan = managedPlan(
    {
      root,
      rows,
      requests,
      sources,
      command: ['history', 'watch', '--login', enabled ? 'on' : 'off'],
    },
    context,
  );
  return { plan, enabled, context };
}
export async function applyHistoryStartup(
  saved: Awaited<ReturnType<typeof planHistoryStartup>>,
  expect: string,
) {
  return applyManagedPlan(
    saved.plan,
    async () => (await planHistoryStartup(saved.plan.root, saved.enabled, saved.context)).plan,
    expect,
  );
}
