import { fileURLToPath } from 'node:url';

/** Bundled entry point, independent of the caller's feature directory or working directory. */
export const cliPath = fileURLToPath(new URL('../../dist/cli.js', import.meta.url));
