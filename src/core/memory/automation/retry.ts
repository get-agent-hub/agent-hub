import { setTimeout as delay } from 'node:timers/promises';
import { HubError } from '../../../shared/errors.js';

/** Retry only pre-write contention/staleness; never retry an unknown transaction failure. */
export async function retryAutomatic<T>(action: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await action();
    } catch (error) {
      if (
        attempt >= 5 ||
        !(error instanceof HubError) ||
        !/^(Another hub update is running\.|Inputs changed since preview\.|Memory (?:file )?changed (?:while reading|during)|Native memory changed (?:while reading|during discovery))/.test(
          error.message,
        )
      )
        throw error;
      await delay(100 * 2 ** attempt);
    }
  }
}
