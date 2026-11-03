#!/usr/bin/env node
import { resetCommand } from './commands/reset.js';
import { Command } from 'commander';
import { packageVersion } from './core/package.js';
import { importCommand } from './commands/import.js';
import { initCommand } from './commands/init.js';
import { mcpLsCommand, mcpRunCommand } from './commands/mcp.js';
import { statusCommand } from './commands/status.js';
import { uiCommand } from './commands/ui.js';
import { syncCommand, restoreCommand } from './commands/sync.js';
import { doctorCommand } from './commands/doctor.js';
import { notImplemented } from './commands/stub.js';
import {
  skillListCommand,
  skillAddCommand,
  skillRemoveCommand,
  repoInitCommand,
} from './commands/content.js';

const program = new Command();

program
  .name('ahub')
  .description(
    'Single source of truth for your AI coding agents: skills, MCP, instructions, memory, task state.',
  )
  .version(packageVersion);

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
  .option('--dry-run', 'show changes and exact commands, write nothing (default)')
  .option('--client <id>', 'only this client')
  .option('--area <area>', 'sync mcp, skills or context (default: mcp)', 'mcp')
  .option(
    '--replace <name...>',
    'explicitly replace selected existing servers; requires --client and reviewed --expect on apply',
  )
  .option('--expect <revision>', 'apply only if this reviewed revision still matches')
  .option('--json', 'machine-readable output')
  .action(syncCommand);
program
  .command('import [item]')
  .description('import mcp or skills from clients; skills use guarded preview/apply')
  .option('--dry-run', 'show the plan, write nothing')
  .option('--apply', 'apply a reviewed skills import')
  .option('--expect <revision>', 'required for applying a skills import')
  .option(
    '--prefer <clients>',
    'source preference (MCP default: claude-code,codex; skills require an explicit choice for differences)',
  )
  .option('--overwrite', 'replace servers that already exist in the hub')
  .option('--json', 'machine-readable output')
  .action(importCommand);
program
  .command('doctor [name]')
  .description('check MCP startup, tool discovery, skills and .env permissions')
  .option('--timeout <seconds>', 'total time limit per server (0.1–120)', '20')
  .option('--client <id>', 'check only the servers enabled for this client')
  .option('--json', 'machine-readable report without raw server logs')
  .action(doctorCommand);
program
  .command('init-repo [directory]')
  .description('add AGENTS.md + .agents/state/{PROJECT,NOW}.md to current repo')
  .option('--dry-run', 'preview without writing (default)')
  .option('--apply', 'apply the reviewed repository setup')
  .option('--expect <revision>', 'required reviewed revision')
  .option('--json', 'machine-readable output')
  .action(repoInitCommand);
program
  .command('restore <backup>')
  .description('preview rollback of client configs from a sync backup')
  .option('--apply', 'restore original files')
  .option('--dry-run', 'show rollback without writing (default)')
  .option('--expect <revision>', 'apply only if this reviewed revision still matches')
  .option('--json', 'machine-readable output')
  .action(restoreCommand);

program
  .command('reset')
  .description('preview return to the first recorded baseline; archive current data')
  .option('--dry-run', 'show the original-state recovery plan without writing (default)')
  .option('--apply', 'restore recorded originals and archive current data')
  .option('--expect <revision>', 'required on apply: exact reviewed reset revision')
  .option(
    '--archive-changes',
    'also restore externally edited client files, saving their current contents',
  )
  .option('--recover-lock', 'recover locks only after verifying that their owner has stopped')
  .option('--json', 'machine-readable output without file contents')
  .action(resetCommand);

const mcp = program.command('mcp').description('manage MCP registry');
mcp
  .command('ls')
  .description('list servers in the hub registry')
  .option('--json')
  .action(mcpLsCommand);
mcp.command('add <name>').action(notImplemented('mcp add'));
mcp.command('rm <name>').action(notImplemented('mcp rm'));
mcp
  .command('run <name>')
  .description('launcher: start MCP over stdio with secrets from .env')
  .action(mcpRunCommand);

const skill = program.command('skill').description('manage skills');
skill
  .command('ls')
  .description('list hub skills')
  .option('--json', 'machine-readable output')
  .action(skillListCommand);
skill
  .command('add <source>')
  .description('preview copying a local skill into the hub')
  .option('--name <name>', 'hub skill name')
  .option('--overwrite', 'explicitly replace an existing hub skill')
  .option('--dry-run', 'preview without writing (default)')
  .option('--apply', 'apply the reviewed plan')
  .option('--expect <revision>', 'required reviewed revision')
  .option('--json', 'machine-readable output')
  .action(skillAddCommand);
skill
  .command('rm <name>')
  .description('preview removing a hub skill with backup')
  .option('--dry-run', 'preview without writing (default)')
  .option('--apply', 'apply the reviewed plan')
  .option('--expect <revision>', 'required reviewed revision')
  .option('--json', 'machine-readable output')
  .action(skillRemoveCommand);

program
  .command('ui')
  .description('open local web UI')
  .option('--port <number>', 'local port (0 picks a free port)', '3082')
  .option('--no-open', 'do not open a browser automatically')
  .action(uiCommand);

program.parseAsync().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
