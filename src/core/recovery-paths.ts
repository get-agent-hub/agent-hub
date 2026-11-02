import path from 'node:path';

/** Recovery data stays outside the hub so a reset can restore an absent hub. */
export const recoveryRoot = (root: string): string => `${path.resolve(root)}.recovery`;
