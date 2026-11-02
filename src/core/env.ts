import fs from 'node:fs/promises';

/**
 * Minimal .env reader/writer. Preserves existing lines and comments; appends new keys.
 * Values are written single-quoted when they contain special characters.
 */

const LINE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/;

function unquote(raw: string): string {
  const v = raw.trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    const inner = v.slice(1, -1);
    return v.startsWith('"') ? inner.replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\') : inner;
  }
  return v.replace(/\s+#.*$/, '');
}

function quote(v: string): string {
  if (/^[A-Za-z0-9_./:@%+,-]*$/.test(v)) return v;
  if (!v.includes("'")) return `'${v}'`;
  return `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
}

export async function readEnvFile(file: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  let text: string;
  try {
    text = await fs.readFile(file, 'utf8');
  } catch {
    return out;
  }
  for (const line of text.split('\n')) {
    const m = LINE.exec(line);
    if (m) out.set(m[1], unquote(m[2]));
  }
  return out;
}

/** Append keys that are not present yet. Throws if a key exists with a different value. */
export async function appendEnv(file: string, vars: Map<string, string>, comment?: string): Promise<string[]> {
  const existing = await readEnvFile(file);
  const added: string[] = [];
  const lines: string[] = [];
  for (const [k, v] of vars) {
    if (existing.has(k)) {
      if (existing.get(k) !== v) throw new Error(`.env already has ${k} with a different value`);
      continue;
    }
    lines.push(`${k}=${quote(v)}`);
    added.push(k);
  }
  if (lines.length) {
    let prefix = '';
    try {
      const cur = await fs.readFile(file, 'utf8');
      if (cur.length && !cur.endsWith('\n')) prefix = '\n';
    } catch {
      /* new file */
    }
    const block = `${prefix}${comment ? `\n# ${comment}\n` : ''}${lines.join('\n')}\n`;
    await fs.appendFile(file, block, { mode: 0o600 });
  }
  await fs.chmod(file, 0o600).catch(() => undefined);
  return added;
}
