import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { HubError } from '../../shared/errors.js';
import { hash, isRecord, stableStringify } from '../../shared/values.js';
import { readSettings } from '../configuration/settings.js';
import { MEMORY_LIMIT, memoryFile, memoryId, type MemoryLocation } from '../memory/store.js';
import { managedPlan, type ArtifactRequest, type ManagedRow } from '../recovery/managed-plan.js';

const exec = promisify(execFile);
interface MemoryProjects {
  version: 1;
  projects: { id: string; connected?: boolean; checkouts: { path: string; identity: string }[] }[];
}

export async function memoryRegistry(root: string, optionalSettings = false) {
  await readSettings(root, optionalSettings);
  const file = await memoryFile(root, path.join(root, 'memory', 'projects.json'));
  let registry: MemoryProjects = { version: 1, projects: [] };
  if (file.text !== null) {
    try {
      const value: unknown = JSON.parse(file.text);
      if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.projects))
        throw new Error();
      const ids = new Set<string>();
      const checkouts = new Set<string>();
      for (const project of value.projects) {
        if (!isRecord(project) || !Array.isArray(project.checkouts) || !project.checkouts.length)
          throw new Error();
        if (project.connected !== undefined && typeof project.connected !== 'boolean')
          throw new Error();
        const id = memoryId(project.id);
        if (ids.has(id)) throw new Error();
        ids.add(id);
        for (const checkout of project.checkouts) {
          if (
            !isRecord(checkout) ||
            typeof checkout.path !== 'string' ||
            !path.isAbsolute(checkout.path) ||
            path.normalize(checkout.path) !== checkout.path ||
            typeof checkout.identity !== 'string' ||
            !/^[a-f0-9]{64}$/.test(checkout.identity) ||
            checkouts.has(checkout.path)
          )
            throw new Error();
          checkouts.add(checkout.path);
        }
      }
      registry = value as unknown as MemoryProjects;
    } catch {
      throw new HubError('Invalid memory project registry. Preserve it and resolve the metadata.');
    }
  }
  return { registry, snapshot: file.snapshot };
}

export async function memoryCheckout(directory: string): Promise<string> {
  try {
    const result = await exec('git', ['rev-parse', '--show-toplevel'], {
      cwd: path.resolve(directory),
      timeout: 3000,
    });
    return await fs.realpath(result.stdout.trim());
  } catch {
    throw new HubError('Choose a project directory inside an existing Git repository.');
  }
}

export async function memoryCheckoutBinding(directory: string) {
  const checkout = await memoryCheckout(directory);
  try {
    const result = await exec('git', ['rev-parse', '--git-common-dir'], {
      cwd: checkout,
      timeout: 3000,
    });
    const common = await fs.realpath(path.resolve(checkout, result.stdout.trim()));
    const stat = await fs.stat(common);
    return {
      path: checkout,
      identity: hash(
        stableStringify({ common, device: stat.dev, inode: stat.ino, birth: stat.birthtimeMs }),
      ),
    };
  } catch {
    throw new HubError('Cannot verify the local Git repository identity.');
  }
}

export async function memoryLocation(
  root: string,
  selector: { shared: true } | { workspace: string },
): Promise<MemoryLocation> {
  await readSettings(root);
  if ('shared' in selector) {
    const directory = path.join(root, 'memory', 'shared');
    return {
      root,
      scope: 'shared',
      directory,
      records: path.join(directory, 'records'),
      index: path.join(root, 'memory', 'MEMORY.md'),
      ownership: path.join(directory, 'index.json'),
      guards: [],
    };
  }
  const checkout = await memoryCheckoutBinding(selector.workspace);
  const { registry, snapshot } = await memoryRegistry(root);
  const project = registry.projects.find((entry) =>
    entry.checkouts.some((binding) => binding.path === checkout.path),
  );
  if (!project)
    throw new HubError(
      'This project has no memory binding. Preview ahub project connect first, or use memory project register <id> for an explicit project ID.',
    );
  if (project.connected === false)
    throw new HubError(
      'This project is disconnected. Preview ahub project connect <directory> to reconnect its retained knowledge.',
    );
  if (
    !project.checkouts.some(
      (binding) => binding.path === checkout.path && binding.identity === checkout.identity,
    )
  )
    throw new HubError(
      'Repository identity changed at this checkout. Review ahub memory project register <id> --rebind before using its memory.',
    );
  const directory = path.join(root, 'memory', 'projects', project.id);
  return {
    root,
    scope: `project:${project.id}`,
    directory,
    records: path.join(directory, 'records'),
    index: path.join(directory, 'MEMORY.md'),
    ownership: path.join(directory, 'index.json'),
    guards: [snapshot],
  };
}

export async function planMemoryProject(
  root: string,
  id: string,
  directory: string,
  rebind = false,
) {
  memoryId(id);
  const checkout = await memoryCheckoutBinding(directory);
  const { registry, snapshot } = await memoryRegistry(root);
  const bound = registry.projects.find((entry) =>
    entry.checkouts.some((binding) => binding.path === checkout.path),
  );
  const rows: ManagedRow[] = [];
  const requests: ArtifactRequest[] = [];
  if (bound && bound.id !== id) {
    rows.push({
      path: checkout.path,
      client: 'memory',
      name: id,
      action: 'conflict',
      note: 'Checkout already belongs to another memory project. Restore its binding before reassigning.',
    });
  } else if (
    bound &&
    bound.connected !== false &&
    bound.checkouts.some(
      (binding) => binding.path === checkout.path && binding.identity === checkout.identity,
    )
  ) {
    rows.push({ path: checkout.path, client: 'memory', name: id, action: 'keep' });
  } else if (
    bound &&
    !rebind &&
    !bound.checkouts.some(
      (binding) => binding.path === checkout.path && binding.identity === checkout.identity,
    )
  ) {
    rows.push({
      path: checkout.path,
      client: 'memory',
      name: id,
      action: 'conflict',
      note: 'Repository identity changed. Use --rebind only after reviewing that this repository should inherit the existing project memory.',
    });
  } else {
    const entry = registry.projects.find((project) => project.id === id);
    if (bound) bound.connected = true;
    if (entry) entry.connected = true;
    if (bound)
      bound.checkouts = bound.checkouts.map((binding) =>
        binding.path === checkout.path ? checkout : binding,
      );
    else if (entry) entry.checkouts.push(checkout);
    else registry.projects.push({ id, checkouts: [checkout] });
    registry.projects.sort((a, b) => a.id.localeCompare(b.id));
    rows.push({
      path: checkout.path,
      client: 'memory',
      name: id,
      action: bound ? 'replace' : 'add',
      note: bound
        ? 'Explicitly allow this repository to inherit the existing project memory.'
        : 'Explicitly bind this checkout; no facts or client configs are changed.',
    });
    const content = JSON.stringify(registry, null, 2) + '\n';
    if (Buffer.byteLength(content) > MEMORY_LIMIT)
      throw new HubError('Memory project registry exceeds its supported size limit.');
    requests.push({
      before: snapshot,
      client: 'memory',
      value: { kind: 'file', content, mode: 0o600 },
    });
  }
  return managedPlan(
    {
      root,
      rows,
      requests,
      sources: [],
      command: [
        'memory',
        'project',
        'register',
        id,
        checkout.path,
        ...(rebind ? ['--rebind'] : []),
      ],
    },
    { checkout, registry },
  );
}
