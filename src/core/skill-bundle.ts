import fs from 'node:fs/promises';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { listSkills } from './fs.js';
import { containsPath, inspectArtifact, type ArtifactSnapshot } from './artifacts.js';
import { inspectTree } from './recovery-tree.js';
import { isRecord } from './values.js';
import { HubError } from './errors.js';

export function validSkillName(name: string): boolean {
  return /^[a-z0-9][a-z0-9._-]{0,127}$/i.test(name);
}
export function assertSkillName(name: string) {
  if (!validSkillName(name))
    throw new HubError(
      'Use a skill name containing letters, digits, dots, underscores or hyphens.',
    );
}
export async function assertPortableSkillName(root: string, name: string) {
  if (
    (await listSkills(path.join(root, 'skills'))).some(
      (entry) => entry.name !== name && entry.name.toLowerCase() === name.toLowerCase(),
    )
  )
    throw new HubError(
      'Skill name collides with an existing hub entry on case-insensitive filesystems.',
    );
}

/** Import self-contained directories only; do not execute code or follow escaping links. */
export async function readSkillBundle(source: string): Promise<ArtifactSnapshot> {
  const real = await fs.realpath(source);
  const node = await inspectArtifact(real);
  if (node.kind !== 'directory' || !(await fs.stat(path.join(real, 'SKILL.md'))).isFile())
    throw new HubError('A skill must be a directory containing SKILL.md.');
  const tree = await inspectTree(real, false, false);
  for (const entry of tree.entries.filter((entry) => entry.kind === 'symlink')) {
    if (
      path.isAbsolute(entry.target!) ||
      !containsPath(real, path.resolve(real, path.dirname(entry.path), entry.target!))
    )
      throw new HubError(
        'Skill contains an absolute or escaping symlink. Make its assets self-contained before importing.',
      );
    if (!containsPath(real, await fs.realpath(path.join(real, entry.path))))
      throw new HubError('Skill symlink resolves outside the source.');
  }
  return node;
}

export async function readSkillMetadata(
  source: string,
): Promise<Record<string, unknown> | undefined> {
  const file = path.join(source, 'SKILL.md');
  if ((await fs.stat(file)).size > 1024 * 1024) return undefined;
  const text = await fs.readFile(file, 'utf8');
  const header = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  if (!header) return undefined;
  try {
    const metadata: unknown = parseYaml(header[1]!);
    return isRecord(metadata) ? metadata : undefined;
  } catch {
    return undefined;
  }
}

export async function listHubSkills(root: string) {
  return Promise.all(
    (await listSkills(path.join(root, 'skills'))).map(async (entry) => ({
      ...entry,
      fingerprint:
        entry.realPath && entry.hasSkillMd
          ? (await inspectArtifact(entry.realPath)).fingerprint
          : null,
    })),
  );
}

export async function linkedSkillDirectory(
  before: ArtifactSnapshot,
): Promise<ArtifactSnapshot | undefined> {
  if (before.kind !== 'symlink') return undefined;
  try {
    const resolved = await inspectArtifact(await fs.realpath(before.path));
    return resolved.kind === 'directory' ? resolved : undefined;
  } catch {
    return undefined;
  }
}
