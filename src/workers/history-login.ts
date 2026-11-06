import {
  backgroundBinding,
  backgroundStopped,
  readBackgroundPolicy,
} from '../core/history/background-state.js';
import { runHistoryBackground } from '../core/history/background-runner.js';

const controller = new AbortController();
process.once('SIGTERM', () => controller.abort());
process.once('SIGINT', () => controller.abort());
try {
  const [root, binding] = process.argv.slice(2);
  if (!root || !binding || (await backgroundBinding(root)) !== binding) process.exitCode = 0;
  else {
    const policy = await readBackgroundPolicy(root);
    if (
      policy?.enabled &&
      policy.binding === binding &&
      !(await backgroundStopped(root, policy.id))
    )
      await runHistoryBackground(root, policy.id, { signal: controller.signal });
  }
} catch {
  // Missing/replaced Hubs, stopped policies and duplicate owners never widen the selected scope.
  process.exitCode = 0;
}
