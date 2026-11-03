import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { memoryHook } from '../core/memory-auto-runtime.js';
import { isRecord } from '../core/values.js';
import { HubError } from '../core/errors.js';

interface Message {
  readonly id: string;
  readonly role: 'user';
  readonly source: { readonly kind: string; readonly form?: string };
  readonly content: readonly { readonly type: 'text'; readonly text: string }[];
}
interface Agent {
  id: string;
  session: { header: { cwd?: string; origin?: string; delegationDepth?: number } };
  inject(message: Message): void;
  steer(message: Message): void;
}
interface Event {
  agent: Agent;
  messages?: readonly Message[];
}
interface Context {
  on(
    event: 'agent/created' | 'agent/turn-stopping',
    callback: (event: Event) => Promise<void>,
  ): void;
  on(
    event: 'agent/pre-step',
    callback: (event: Event, next: () => Promise<unknown>) => Promise<unknown>,
  ): void;
  get?(service: string): { get(session: Agent['session']): string } | undefined;
  effect(callback: () => () => Promise<void>): void;
  logger: { warn(message: string): void };
}

export const name = 'agent-hub-memory';

function contextMessage(text: string): Message {
  return Object.freeze({
    id: randomUUID(),
    role: 'user',
    source: Object.freeze({ kind: 'agent-hub-memory', form: 'notice' }),
    content: Object.freeze([Object.freeze({ type: 'text', text })]),
  });
}

/** Native Cordis adapter: no optional hook bridge, transcript parser or provider dependency. */
export function apply(ctx: Context, config: { root: string }) {
  if (!config || typeof config.root !== 'string' || !path.isAbsolute(config.root))
    throw new HubError('DSH memory requires an absolute Hub root.');
  let closing = false;
  const tasks = new Set<Promise<void>>();
  const perform = (agent: Agent, event: string, prompt?: string) => {
    if (
      closing ||
      agent.session.header.origin === 'subagent' ||
      (agent.session.header.delegationDepth ?? 0) > 0
    )
      return Promise.resolve();
    const task = (async () => {
      try {
        const cwd = ctx.get?.('workingDirectory')?.get(agent.session) ?? agent.session.header.cwd;
        if (!cwd) throw new HubError('DSH did not supply a workspace for memory.');
        const result = await memoryHook(config.root, 'dsh', {
          cwd,
          session_id: agent.id,
          hook_event_name: event,
          ...(prompt === undefined ? {} : { prompt }),
        });
        if (closing) return;
        if ('systemMessage' in result && typeof result.systemMessage === 'string')
          ctx.logger.warn(result.systemMessage);
        if (result.decision === 'block' && typeof result.reason === 'string')
          agent.steer(contextMessage(result.reason));
        if (
          'hookSpecificOutput' in result &&
          isRecord(result.hookSpecificOutput) &&
          typeof result.hookSpecificOutput.additionalContext === 'string'
        )
          agent.inject(contextMessage(result.hookSpecificOutput.additionalContext));
      } catch (error) {
        ctx.logger.warn(
          error instanceof HubError
            ? error.message
            : 'Agent Hub memory callback failed; the DSH task can continue.',
        );
      }
    })();
    tasks.add(task);
    void task.finally(() => tasks.delete(task));
    return task;
  };
  ctx.effect(() => async () => {
    closing = true;
    await Promise.allSettled([...tasks]);
  });
  ctx.on('agent/created', ({ agent }) => perform(agent, 'SessionStart'));
  ctx.on('agent/pre-step', async ({ agent, messages }, next) => {
    const decision = await next();
    if (isRecord(decision) && decision.kind === 'enter') {
      const prompts = (messages ?? []).filter((message) => message.source.kind === 'user');
      if (prompts.length)
        await perform(
          agent,
          'UserPromptSubmit',
          prompts
            .flatMap((message) =>
              message.content.filter((block) => block.type === 'text').map((block) => block.text),
            )
            .join('\n'),
        );
    }
    return decision;
  });
  ctx.on('agent/turn-stopping', ({ agent }) => perform(agent, 'Stop'));
}
