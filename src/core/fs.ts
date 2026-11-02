import { HubError } from './errors.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { SkillEntry } from './types.js';

export async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw new HubError('Cannot inspect a configuration path. Check file permissions.');
  }
}

export async function readText(p: string): Promise<string | undefined> {
  try {
    return await fs.readFile(p, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw new HubError('Cannot read a configuration file. Check file permissions.');
  }
}

/** List skill directories (entries with SKILL.md) under a root. Follows symlinks. */
export async function listSkills(root: string): Promise<SkillEntry[]> {
  let names: string[];
  try {
    names = await fs.readdir(root);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw new HubError('Cannot read a skills directory. Check file permissions.');
  }
  const out: SkillEntry[] = [];
  for (const name of names.sort()) {
    if (name.startsWith('.')) continue;
    const p = path.join(root, name);
    let realPath: string;
    try {
      realPath = await fs.realpath(p);
      if (!(await fs.stat(realPath)).isDirectory()) continue;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
        throw new HubError('Cannot inspect a skill directory. Check file permissions.');
      // broken symlink
      out.push({ name, path: p, realPath: '', hasSkillMd: false });
      continue;
    }
    out.push({
      name,
      path: p,
      realPath,
      hasSkillMd: await exists(path.join(realPath, 'SKILL.md')),
    });
  }
  return out;
}
