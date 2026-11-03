import { confirm, interactive } from '../core/prompt.js';
import { HubError } from '../core/errors.js';

export async function confirmReviewed(
  options: { interactive?: boolean; json?: boolean; dryRun?: boolean },
  blocked: boolean,
  io = { available: interactive, confirm },
) {
  if (!options.interactive || blocked) return false;
  if (options.json || options.dryRun || !io.available())
    throw new HubError(
      '--interactive requires a terminal and cannot be combined with --json or --dry-run.',
    );
  return io.confirm('Apply this exact reviewed plan?', false);
}
