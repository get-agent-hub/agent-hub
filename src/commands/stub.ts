import { c } from '../core/output.js';

/** Placeholder for commands planned in docs/DESIGN.md but not implemented yet. */
export function notImplemented(name: string, step: string) {
  return () => {
    console.error(c.yellow(`\`${name}\` is not implemented yet`) + c.dim(` — planned in DESIGN.md §7, step ${step}.`));
    process.exitCode = 2;
  };
}
