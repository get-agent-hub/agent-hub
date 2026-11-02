import { HubError } from './errors.js';
import { readOptionalText } from './file-store.js';

const ASSIGNMENT = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/;
const DOUBLE_QUOTED = /^"((?:\\[\s\S]|[^"\\])*)"\s*(?:#.*)?$/;
const SINGLE_QUOTED = /^'([^']*)'\s*(?:#.*)?$/;

/** Read dotenv values without expanding references or modifying process.env. */
export function parseEnvText(text: string): Map<string, string> {
  const result = new Map<string, string>();
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    const match = ASSIGNMENT.exec(lines[index]);
    if (!match) continue;
    let raw = match[2].trim();
    const quote = raw[0];
    if (quote === '"' || quote === "'") {
      const pattern = quote === '"' ? DOUBLE_QUOTED : SINGLE_QUOTED;
      while (!pattern.test(raw) && index + 1 < lines.length) raw += `\n${lines[++index]}`;
      const quoted = pattern.exec(raw);
      if (!quoted)
        throw new HubError(
          'Cannot parse a quoted .env value. Check quoting without sharing credentials.',
        );
      const escapes: Record<string, string> = { n: '\n', r: '\r', t: '\t', '"': '"', '\\': '\\' };
      result.set(
        match[1],
        quote === "'"
          ? quoted[1]
          : quoted[1].replace(/\\([nrt"\\])/g, (_, char: string) => escapes[char]),
      );
    } else result.set(match[1], raw.replace(/\s+#.*$/, ''));
  }
  return result;
}

export async function readEnvFile(file: string): Promise<Map<string, string>> {
  return parseEnvText((await readOptionalText(file)) ?? '');
}

/** Preserve existing text and append only new keys; credentials never enter error messages. */
export function renderEnvAppend(current: string, vars: Map<string, string>, comment?: string) {
  const existing = parseEnvText(current);
  const added: string[] = [];
  const lines: string[] = [];
  for (const [key, value] of vars) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key))
      throw new HubError('Invalid environment variable name.');
    if (existing.has(key)) {
      if (existing.get(key) !== value)
        throw new HubError(`.env already has ${key} with a different value.`);
      continue;
    }
    const encoded = /^[A-Za-z0-9_./:@%+,-]*$/.test(value) ? value : JSON.stringify(value);
    lines.push(`${key}=${encoded}`);
    added.push(key);
  }
  const prefix = current && !current.endsWith('\n') ? '\n' : '';
  const label = comment ? `\n# ${comment.replace(/[\r\n]/g, ' ')}\n` : '';
  return {
    content: lines.length ? `${current}${prefix}${label}${lines.join('\n')}\n` : current,
    added,
  };
}
