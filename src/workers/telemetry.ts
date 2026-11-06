import { sendUsage } from '../core/telemetry/usage.js';

// No argv context, inherited app credentials or output. Bound stdin and total lifetime.
const timeout = setTimeout(() => process.exit(0), 2000);
try {
  let input = '';
  for await (const chunk of process.stdin) {
    input += String(chunk);
    if (input.length > 512) throw new Error('Too large.');
  }
  await sendUsage(JSON.parse(input));
} catch {
  /* Drop malformed or interrupted attempts. */
} finally {
  clearTimeout(timeout);
}
