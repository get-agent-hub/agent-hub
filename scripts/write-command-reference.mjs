import { writeFile } from 'node:fs/promises';
import { format } from 'prettier';
import { commandReference } from '../dist/commands/catalog.js';

await writeFile(
  new URL('../docs/CLI.md', import.meta.url),
  await format(commandReference(), { parser: 'markdown' }),
);
console.log('Updated docs/CLI.md from the supported command catalog.');
