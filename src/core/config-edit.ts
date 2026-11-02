import { parse as parseToml, stringify as stringifyToml } from 'smol-toml';
import { isMap, isSeq, parseDocument, type YAMLMap, type YAMLSeq } from 'yaml';
import type { ClientId } from './types.js';

export const MCP_PLUGIN = '@deepseek-ai/dsh-mcp-client';
export type Definition = Record<string, unknown>;

import { HubError } from './errors.js';
import { isRecord } from './values.js';

function tomlSections(text: string) {
  const sections: { start: number; end: number; parts: string[] }[] = [];
  let quote = '';
  let offset = 0;
  for (const line of text.split(/(?<=\n)/)) {
    if (!quote && /^\s*\[/.test(line)) {
      const header = line.trim();
      try {
        let node: unknown = parseToml(`${header}\n__ahub_probe__ = true\n`);
        const parts: string[] = [];
        while (isRecord(node) && !Object.hasOwn(node, '__ahub_probe__')) {
          const key = Object.keys(node)[0];
          parts.push(key);
          node = node[key];
          if (Array.isArray(node)) node = node[0];
        }
        if (sections.length) sections[sections.length - 1].end = offset;
        sections.push({ start: offset, end: text.length, parts });
      } catch {
        throw new HubError('Cannot safely identify TOML table boundaries.');
      }
    }
    // Do not mistake table-looking text inside multiline TOML strings for headers.
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (!quote && char === '#') break;
      if (quote === '"""' || quote === "'''") {
        if (quote === '"""' && char === '\\') {
          i++;
          continue;
        }
        if (line.slice(i, i + 3) === quote) {
          let run = 3;
          while (line[i + run] === quote[0]) run++;
          i += run - 1;
          quote = '';
        }
      } else if (quote) {
        if (quote === '"' && char === '\\') i++;
        else if (char === quote) quote = '';
      } else if (char === '"' || char === "'") {
        quote = line.slice(i, i + 3) === char.repeat(3) ? char.repeat(3) : char;
        if (quote.length === 3) i += 2;
      }
    }
    offset += line.length;
  }
  return sections;
}

export function readDefinitions(client: ClientId, text: string | null): Map<string, Definition> {
  try {
    if (client !== 'dsh') {
      const doc: unknown =
        text === null ? {} : client === 'codex' ? parseToml(text) : JSON.parse(text);
      if (!isRecord(doc)) throw new Error();
      const entries = doc[client === 'codex' ? 'mcp_servers' : 'mcpServers'] ?? {};
      if (!isRecord(entries) || Object.values(entries).some((v) => !isRecord(v))) throw new Error();
      return new Map(Object.entries(entries) as [string, Definition][]);
    }
    const doc = parseDocument(text ?? '[]');
    if (doc.errors.length || !isSeq(doc.contents)) throw new Error();
    const entries = new Map<string, Definition>();
    walkDsh(doc.contents, (item) => {
      if (item.get('name') !== MCP_PLUGIN) return;
      const raw = item.get('config');
      if (!isMap(raw)) throw new Error();
      const cfg = raw.toJSON() as Definition;
      const name = String(cfg.serverName ?? item.get('id') ?? '');
      if (!name || entries.has(name)) throw new Error();
      entries.set(name, cfg);
    });
    return entries;
  } catch {
    throw new HubError(`Cannot parse ${client} MCP configuration safely. No changes were made.`);
  }
}

function walkDsh(seq: YAMLSeq, fn: (item: YAMLMap) => void) {
  for (const item of seq.items) {
    if (!isMap(item)) throw new HubError('Unsupported DSH patch entry.');
    fn(item);
    const insert = item.get('insert');
    if (insert !== undefined) {
      if (!isSeq(insert)) throw new HubError('Unsupported DSH insert block.');
      walkDsh(insert, fn);
    }
  }
}

/** Change selected MCP records while preserving unrelated configuration text. */
export function editDefinitions(
  client: ClientId,
  original: string | null,
  changes: Map<string, Definition | null>,
): string {
  if (!changes.size) return original ?? '';
  readDefinitions(client, original);
  if (client === 'claude-code') {
    const doc = original === null ? {} : JSON.parse(original);
    const entries = { ...(doc.mcpServers ?? {}) };
    for (const [name, value] of changes) {
      if (value === null) delete entries[name];
      else
        Object.defineProperty(entries, name, {
          value,
          enumerable: true,
          configurable: true,
          writable: true,
        });
    }
    doc.mcpServers = entries;
    const indent = original?.match(/\n([ \t]+)"/)?.[1] ?? '  ';
    return (
      JSON.stringify(doc, null, indent) + (original === null || original.endsWith('\n') ? '\n' : '')
    );
  }
  if (client === 'codex') {
    const text = original ?? '';
    const current = readDefinitions(client, original);
    const sections = tomlSections(text);
    for (const name of current.keys()) {
      if (
        changes.has(name) &&
        !sections.some((s) => s.parts[0] === 'mcp_servers' && s.parts[1] === name)
      ) {
        throw new HubError(
          'Inline or dotted MCP assignments in Codex need explicit [mcp_servers.<name>] tables before sync.',
        );
      }
    }
    const removed = sections.filter((s) => s.parts[0] === 'mcp_servers' && changes.has(s.parts[1]));
    let result = text;
    for (const section of removed.reverse()) {
      const chunk = text.slice(section.start, section.end);
      const trailing = chunk.match(/(?:\r?\n[ \t]*(?:#[^\r\n]*)?)*\r?\n?$/)?.[0] ?? '';
      result = result.slice(0, section.start) + trailing + result.slice(section.end);
    }
    for (const [name, value] of changes) {
      if (value !== null)
        result += `${result && !result.endsWith('\n') ? '\n' : ''}\n${stringifyToml({ mcp_servers: { [name]: value } })}`;
    }
    readDefinitions(client, result);
    return result;
  }
  const doc = parseDocument(original ?? '[]');
  const seq = doc.contents as YAMLSeq;
  const pending = new Map(changes);
  function edit(items: YAMLSeq) {
    for (let i = items.items.length - 1; i >= 0; i--) {
      const item = items.items[i] as YAMLMap;
      if (item.get('name') === MCP_PLUGIN) {
        const cfg = item.get('config') as YAMLMap;
        const name = String(cfg.get('serverName') ?? item.get('id'));
        if (pending.has(name)) {
          const next = pending.get(name)!;
          if (next === null) items.items.splice(i, 1);
          else item.set('config', doc.createNode(next));
          pending.delete(name);
        }
      }
      const insert = item.get('insert');
      if (isSeq(insert)) edit(insert);
    }
  }
  edit(seq);
  const added = [...pending]
    .filter(([, v]) => v !== null)
    .map(([name, config]) => ({ id: `agenthub-mcp-${name}`, name: MCP_PLUGIN, config }));
  if (added.length) seq.add(doc.createNode({ insert: added }));
  const result = doc.toString({ lineWidth: 0 });
  readDefinitions(client, result);
  return result;
}
