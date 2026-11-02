#!/usr/bin/env node
import { Command } from 'commander';
import { importCommand } from './commands/import.js';
import { initCommand } from './commands/init.js';
import { mcpLsCommand, mcpRunCommand } from './commands/mcp.js';
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

program
  .command('init')
  .description('create (or adopt) ~/.agent-hub: layout, .env, .gitignore, git')
  .option('-y, --yes', 'accept defaults, no questions')
  .option('--remote <url>', 'git remote to add')
  .option('--no-git', 'do not track the hub in git')
  .action(initCommand);
program
  .command('sync')
  .description('project hub state into client configs (dry-run by default)')
  .option('--apply', 'write changes (with backup)')
  .option('--client <id>', 'only this client')
  .action(notImplemented('sync', '4–5'));
program
  .command('import [item]')
  .description('pull client definitions into the hub (item: mcp | mcp:<name>); secrets → .env')
  .option('--dry-run', 'show the plan, write nothing')
  .option('--prefer <clients>', 'on conflict take config from (comma list)', 'claude-code,codex')
  .option('--overwrite', 'replace servers that already exist in the hub')
  .option('--json', 'machine-readable output')
  .action(importCommand);
program.command('doctor').description('health-check MCP servers, symlinks, permissions').action(notImplemented('doctor', '5'));
program.command('init-repo').description('add AGENTS.md + .agents/state/{PROJECT,NOW}.md to current repo').action(notImplemented('init-repo', '7'));
program.command('restore <backup>').description('restore client configs from a backup').action(notImplemented('restore', '5'));

const mcp = program.command('mcp').description('manage MCP registry');
mcp.command('ls').description('list servers in the hub registry').option('--json').action(mcpLsCommand);
mcp.command('add <name>').action(notImplemented('mcp add', '4'));
mcp.command('rm <name>').action(notImplemented('mcp rm', '4'));
mcp.command('run <name>').description('launcher: start MCP over stdio with secrets from .env').action(mcpRunCommand);

const skill = program.command('skill').description('manage skills');
skill.command('ls').action(notImplemented('skill ls', '3'));
skill.command('add <source>').action(notImplemented('skill add', '3'));
skill.command('rm <name>').action(notImplemented('skill rm', '3'));

program.command('ui').description('open local web UI').action(notImplemented('ui', 'v0.2'));

program.parseAsync().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
