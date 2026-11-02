#!/usr/bin/env node
import { Command } from 'commander';
import { statusCommand } from './commands/status.js';
import { notImplemented } from './commands/stub.js';

const program = new Command();

program
  .name('ahub')
  .description('Single source of truth for your AI coding agents: skills, MCP, instructions, memory, task state.')
  .version('0.0.0');

program
  .command('status')
  .description('show hub vs clients: skills, MCP servers, drift')
  .option('--json', 'machine-readable output')
  .action(statusCommand);

program.command('init').description('create ~/.agent-hub, detect clients, import existing setup').action(notImplemented('init', '2'));
program
  .command('sync')
  .description('project hub state into client configs (dry-run by default)')
  .option('--apply', 'write changes (with backup)')
  .option('--client <id>', 'only this client')
  .action(notImplemented('sync', '4–5'));
program.command('import [item]').description('pull client-side changes into the hub').action(notImplemented('import', '5'));
program.command('doctor').description('health-check MCP servers, symlinks, permissions').action(notImplemented('doctor', '5'));
program.command('init-repo').description('add AGENTS.md + .agents/state/{PROJECT,NOW}.md to current repo').action(notImplemented('init-repo', '7'));
program.command('restore <backup>').description('restore client configs from a backup').action(notImplemented('restore', '5'));

const mcp = program.command('mcp').description('manage MCP registry');
mcp.command('ls').action(notImplemented('mcp ls', '4'));
mcp.command('add <name>').action(notImplemented('mcp add', '4'));
mcp.command('rm <name>').action(notImplemented('mcp rm', '4'));
mcp.command('run <name>').description('launcher: start MCP with secrets from .env').action(notImplemented('mcp run', '4'));

const skill = program.command('skill').description('manage skills');
skill.command('ls').action(notImplemented('skill ls', '3'));
skill.command('add <source>').action(notImplemented('skill add', '3'));
skill.command('rm <name>').action(notImplemented('skill rm', '3'));

program.command('ui').description('open local web UI').action(notImplemented('ui', 'v0.2'));

program.parseAsync().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
