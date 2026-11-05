import { HubError } from '../shared/errors.js';
import { confirm, interactive } from '../shared/prompt.js';

export interface ReviewOptions {
  interactive?: boolean;
  terminalDefault?: boolean;
  apply?: boolean;
  json?: boolean;
  dryRun?: boolean;
}

export function reviewMode(
  options: ReviewOptions,
  available = interactive,
): 'apply' | 'preview' | 'prompt' {
  if (options.apply && options.dryRun) throw new HubError('Choose --apply or --dry-run, not both.');
  if (options.interactive && (options.apply || options.json || options.dryRun || !available()))
    throw new HubError(
      '--interactive requires a terminal and cannot be combined with --apply, --json or --dry-run.',
    );
  if (options.apply) return 'apply';
  if (options.json || options.dryRun) return 'preview';
  return options.interactive || (options.terminalDefault && available()) ? 'prompt' : 'preview';
}

export async function confirmReviewed(
  options: ReviewOptions,
  blocked: boolean,
  io = { available: interactive, confirm },
) {
  if (reviewMode(options, io.available) !== 'prompt' || blocked) return false;
  return io.confirm('Apply this exact reviewed plan?', false);
}
