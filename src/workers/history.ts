import { runHistoryBackground } from '../core/history/background-runner.js';

const controller = new AbortController();
const stop = () => controller.abort();
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
try {
  const [root, id] = process.argv.slice(2);
  if (!root || !/^[a-f0-9]{32}$/.test(id ?? '')) throw new Error('Invalid worker arguments.');
  await runHistoryBackground(root, id!, {
    signal: controller.signal,
    ready() {
      process.send?.({ ready: true });
    },
  });
} catch {
  process.exitCode = 1;
} finally {
  if (process.connected) process.disconnect();
}
