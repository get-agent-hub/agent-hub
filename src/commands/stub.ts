import { c } from '../core/output.js';

/** Placeholder for commands planned in docs/DESIGN.md but not implemented yet. */
export function notImplemented(name: string) {
  return () => {
    console.error(
      c.yellow(`\`${name}\` is not implemented yet`) +
        c.dim(' — see docs/DESIGN.md for planned work.'),
    );
    process.exitCode = 2;
  };
}
