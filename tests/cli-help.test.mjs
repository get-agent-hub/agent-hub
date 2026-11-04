import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { format } from 'prettier';
import { commandGuide, commandReference } from '../dist/commands/catalog.js';

const help = (...args) =>
  execFileSync(process.execPath, ['dist/cli.js', ...args], { encoding: 'utf8' });
test('default help and no-argument startup teach six public command groups without starting a server', () => {
  const text = help('--help');
  const names = [...text.matchAll(/^ {2}([a-z][\w-]*) *(?:\[|$| {2})/gm)].map((match) => match[1]);
  assert.deepEqual(names, ['quick', 'ui', 'status', 'doctor', 'project', 'undo']);
  assert.match(text, /--advanced/);
  assert.equal(help(), text);
  for (const command of ['init', 'import', 'sync', 'skill', 'memory', 'mcp', 'restore', 'reset'])
    assert.doesNotMatch(text, new RegExp(`^  ${command}(?: |$)`, 'm'));
});

test('full help and direct advanced/runtime help retain every supported purpose and caller', () => {
  const all = help('--advanced', '--help');
  for (const command of ['init', 'import', 'sync', 'skill', 'memory', 'mcp', 'restore', 'reset'])
    assert.match(all, new RegExp(`^  ${command}(?: |$)`, 'm'));
  assert.equal(new Set(commandGuide.map((guide) => guide.command)).size, commandGuide.length);
  for (const guide of commandGuide) {
    const text = help('--advanced', ...guide.command.split(' '), '--help');
    assert.match(text, /Used by:/, guide.command);
    assert.ok(text.includes(guide.audience), guide.command);
    assert.ok(guide.purpose.length > 30, guide.command);
  }
  assert.doesNotMatch(help('--advanced', 'mcp', '--help'), /^ {2}(add|rm)(?: |$)/m);
});

test('technical options stay usable but leave public quick help, including after the command', () => {
  assert.doesNotMatch(help('quick', '--help'), /--expect|--apply|--at|--interactive|--json/);
  for (const flag of ['--expect', '--apply', '--at', '--interactive', '--json'])
    assert.ok(help('--advanced', 'quick', '--help').includes(flag));
  assert.match(help('quick', '--advanced', '--help'), /--expect/);
  const result = spawnSync(process.execPath, ['dist/cli.js', 'quick', '--apply'], {
    encoding: 'utf8',
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /expect/);
});

test('the packaged command reference documents the supported catalog without drift', async () => {
  assert.equal(
    await readFile('docs/CLI.md', 'utf8'),
    await format(commandReference(), { parser: 'markdown' }),
  );
});
