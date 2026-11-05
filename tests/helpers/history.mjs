import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { historySource } from '../../dist/adapters/history/sources.js';
import { recoveryRoot } from '../../dist/shared/recovery-paths.js';

export async function historyFixture(t) {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'ahub-history-'));
  const root = path.join(temporary, 'hub');
  t.after(async () => {
    await fs.rm(temporary, { recursive: true, force: true });
    await fs.rm(recoveryRoot(root), { recursive: true, force: true });
  });
  const project = path.join(temporary, 'project-a');
  const other = path.join(temporary, 'project-b');
  await fs.mkdir(project);
  await fs.mkdir(other);
  const source = historySource('claude-code', path.join(temporary, 'claude', 'projects'));
  const file = path.join(source.root, 'encoded-project', 'native-chat.jsonl');
  await fs.mkdir(path.dirname(file), { recursive: true });
  const messages = [
    {
      type: 'user',
      uuid: 'u1',
      sessionId: 'native-chat',
      cwd: project,
      message: { role: 'user', content: [{ type: 'text', text: 'A useful conversation title' }] },
    },
    {
      type: 'assistant',
      uuid: 'a1',
      parentUuid: 'u1',
      sessionId: 'native-chat',
      cwd: project,
      message: {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Middle sentinel 🦊' },
          {
            type: 'tool_use',
            id: 'call-1',
            name: 'example',
            input: { proposed: 'not executed by Hub' },
          },
        ],
      },
    },
    {
      type: 'user',
      uuid: 'u2',
      parentUuid: 'a1',
      sessionId: 'native-chat',
      cwd: project,
      message: {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'call-1',
            content: 'End sentinel with a tool result',
          },
        ],
      },
    },
    { type: 'future-event', sessionId: 'native-chat', evidence: { unknown: 'retained extension' } },
  ];
  const encode = (rows) => rows.map((row) => JSON.stringify(row)).join('\n') + '\n';
  await fs.writeFile(file, encode(messages));
  return { temporary, root, project, other, source, file, messages, encode };
}
