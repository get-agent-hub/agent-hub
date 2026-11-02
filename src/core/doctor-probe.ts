import { fork } from 'node:child_process';
import { isRecord as object } from './values.js';
import { classifyFailure, failure, type ProbeResult } from './doctor-types.js';
import type { DoctorContext } from './doctor.js';

export async function probe(
  name: string,
  timeoutMs: number,
  context: DoctorContext,
  signal?: AbortSignal,
): Promise<ProbeResult> {
  if (signal?.aborted) return { status: 'cancelled', phase: 'preflight', tools: null };
  return new Promise((resolve) => {
    const child = fork(context.worker, [name, String(timeoutMs)], {
      execPath: context.node,
      execArgv: [],
      detached: process.platform !== 'win32',
      env: { ...process.env, AGENT_HUB_HOME: context.root },
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    });
    let finishing = false;
    let phase: 'initialize' | 'tools/list' = 'initialize';
    const kill = (signal: NodeJS.Signals) => {
      if (!child.pid) return;
      try {
        if (process.platform === 'win32') child.kill(signal);
        else process.kill(-child.pid, signal);
      } catch {
        /* already stopped */
      }
    };
    const finish = (result: ProbeResult) => {
      if (finishing) return;
      finishing = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancel);
      kill('SIGTERM');
      // Also reap npm/uvx/server descendants when the immediate launcher has already exited.
      setTimeout(() => {
        kill('SIGKILL');
        resolve(result);
      }, 200);
    };
    const cancel = () => finish({ status: 'cancelled', phase, tools: null });
    const timer = setTimeout(
      () => finish({ status: 'failed', phase, tools: null, error: failure('timeout') }),
      timeoutMs,
    );
    child.once('error', (error) =>
      finish({ status: 'failed', phase: 'preflight', tools: null, error: classifyFailure(error) }),
    );
    child.once('exit', () =>
      finish({
        status: 'failed',
        phase: 'initialize',
        tools: null,
        error: failure('process-exit'),
      }),
    );
    child.on('message', (message) => {
      if (object(message) && message.event === 'phase' && message.phase === 'tools/list') {
        phase = 'tools/list';
        return;
      }
      if (
        !object(message) ||
        !['ok', 'failed'].includes(String(message.status)) ||
        !['initialize', 'tools/list'].includes(String(message.phase))
      )
        return;
      if (
        message.tools !== null &&
        (!Number.isInteger(message.tools) ||
          Number(message.tools) < 0 ||
          Number(message.tools) > 10000)
      )
        return;
      finish(message as unknown as ProbeResult);
    });
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) cancel();
  });
}
