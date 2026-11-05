import type { HistoryPart } from '../../contracts/history.js';
import { isRecord } from '../../shared/values.js';

const text = (value: unknown) => (typeof value === 'string' ? value : undefined);
function argumentsText(value: unknown) {
  if (typeof value !== 'string') return JSON.stringify(value ?? {}, null, 2);
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}

/** Native display projection only. Unknown blocks and the complete raw event stay retrievable. */
export function historyParts(content: unknown): HistoryPart[] {
  if (typeof content === 'string') return content ? [{ kind: 'text', text: content }] : [];
  if (!Array.isArray(content)) return [];
  return content.map((value): HistoryPart => {
    const block = isRecord(value) ? value : {};
    const type = text(block.type) ?? '';
    if (['text', 'input_text', 'output_text', 'summary_text', 'text/plain'].includes(type))
      return { kind: 'text', text: text(block.text) ?? text(block.content) ?? '' };
    if (['reasoning', 'thinking', 'reasoning/text'].includes(type))
      return { kind: 'reasoning', text: text(block.text) ?? text(block.thinking) ?? '' };
    if (['tool_use', 'tool-call', 'function_call', 'custom_tool_call'].includes(type))
      return {
        kind: 'tool-call',
        text: argumentsText(block.arguments ?? block.input),
        name: text(block.name),
        id: text(block.id) ?? text(block.call_id),
      };
    if (
      ['tool_result', 'tool-result', 'function_call_output', 'custom_tool_call_output'].includes(
        type,
      )
    ) {
      const body = block.content ?? block.output;
      const parts = historyParts(body);
      return {
        kind: 'tool-result',
        text: parts.length ? parts.map((part) => part.text).join('\n') : argumentsText(body),
        id: text(block.tool_use_id) ?? text(block.call_id) ?? text(block.id),
        name: text(block.name),
      };
    }
    if (['image', 'image_url', 'input_image', 'file', 'document', 'attachment'].includes(type))
      return {
        kind: 'attachment',
        text:
          text(block.filename) ??
          text(block.name) ??
          `[${type} attachment — original data is preserved]`,
      };
    return { kind: 'unknown', text: JSON.stringify(value) };
  });
}
