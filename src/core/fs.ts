import fs from 'node:fs/promises';
import path from 'node:path';
import type { SkillEntry } from './types.js';

export async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

export async function readText(p: string): Promise<string | undefined> {
  try {
    return await fs.readFile(p, 'utf8');
  } catch {
    return undefined;
  }
}

export async function readJson<T = unknown>(p: string): Promise<T | undefined> {
  const text = await readText(p);
  if (text === undefined) return undefined;
  return JSON.parse(text) as T;
}

/** List skill directories (entries with SKILL.md) under a root. Follows symlinks. */
export async function listSkills(root: string): Promise<SkillEntry[]> {
  let names: string[];
  try {
    names = await fs.readdir(root);
  } catch {
    return [];
  }
  const out: SkillEntry[] = [];
  for (const name of names.sort()) {
    if (name.startsWith('.')) continue;
    const p = path.join(root, name);
    let realPath: string;
    try {
      realPath = await fs.realpath(p);
      if (!(await fs.stat(realPath)).isDirectory()) continue;
    } catch {
      // broken symlink
      out.push({ name, path: p, realPath: '', hasSkillMd: false });
      continue;
    }
    out.push({ name, path: p, realPath, hasSkillMd: await exists(path.join(realPath, 'SKILL.md')) });
  }
  return out;
}
