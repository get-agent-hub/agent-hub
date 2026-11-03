#!/usr/bin/env node
import { quickCommand } from './commands/quick.js';
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
  memoryGetCommand,
  memoryListCommand,
  memoryWriteCommand,
  memoryProjectCommand,
  memoryProjectsCommand,
} from './commands/memory.js';
import { serveMemory } from './mcp/memory.js';
import { hubRoot } from './core/paths.js';
import { memoryDiscoverCommand, memoryOnboardCommand } from './commands/memory-onboarding.js';
import {
  autoEnableCommand,
  autoDisableCommand,
  autoSyncCommand,
  autoHookCommand,
  autoCheckpointCommand,
  autoStatusCommand,
  autoWatchCommand,
  autoConflictGetCommand,
  autoConflictResolveCommand,
} from './commands/memory-auto.js';
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
  .command('quick')
  .description('preview or run Hub setup, collection, project memory and delivery in one workflow')
  .option('--workspace <directory>', 'Git workspace (default: cwd)')
  .option(
    '--client <ids>',
    'comma-separated detected clients (default: all enabled detected clients)',
  )
  .option('--prefer <id>', 'explicit source preference when imported client copies differ')
  .option('--no-project', 'only configure global MCP, skills and shared context')
  .option('--no-automation', 'import project memory without enabling lifecycle hooks')
  .option('--at <timestamp>', 'timestamp captured in the reviewed quick command')
  .option('--dry-run', 'preview workflow, write nothing (default)')
  .option('--apply', 'run the reviewed staged workflow with existing recovery protections')
  .option('--expect <revision>', 'required reviewed workflow revision')
  .option('--json', 'machine-readable preview or per-stage result')
  .action(quickCommand);

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

const memory = program
  .command('memory')
  .description('manage scoped knowledge shared between agents');
function memoryScope(command: Command) {
  return command
    .option('--shared', 'explicitly select shared memory instead of the current project')
    .option('--workspace <directory>', 'select the project bound to this checkout (default: cwd)')
    .option('--json', 'machine-readable output');
}
function memoryWriteOptions(command: Command) {
  return memoryScope(command)
    .option('--title <text>', 'record title (required on create)')
    .option('--file <path>', 'read selected knowledge from a local UTF-8 file')
    .option('--kind <kind>', 'fact, preference, decision or lesson')
    .option(
      '--tag <tag>',
      'record tag; repeat to set multiple tags',
      (value: string, previous: string[] = []) => [...previous, value],
    )
    .option('--clear-tags', 'remove all tags on update')
    .option('--source <reference>', 'source attribution; no source is fetched')
    .option('--clear-source', 'remove source attribution on update')
    .option('--record-revision <revision>', 'required current record revision on update/delete')
    .option('--at <timestamp>', 'timestamp captured in the reviewed command')
    .option('--dry-run', 'preview without writing (default)')
    .option('--apply', 'apply the reviewed operation with a backup')
    .option('--expect <revision>', 'required reviewed plan revision');
}
memoryScope(memory.command('ls').description('list records in the selected scope'))
  .option('--limit <count>', 'maximum results, 1–100', '50')
  .action((options) => memoryListCommand('', options));
memoryScope(
  memory.command('search <query>').description('search titles, tags and bodies in one scope'),
)
  .option('--limit <count>', 'maximum results, 1–100', '50')
  .action(memoryListCommand);
memoryScope(
  memory.command('get <id>').description('read a record and its current revision'),
).action(memoryGetCommand);
for (const [name, operation] of [
  ['add', 'create'],
  ['update', 'update'],
  ['rm', 'delete'],
] as const)
  memoryWriteOptions(memory.command(`${name} <id>`)).action((id, options) =>
    memoryWriteCommand(operation, id, options),
  );
memoryWriteOptions(
  memory
    .command('import <id>')
    .description('copy explicitly selected local knowledge into a new record; preserve the source'),
).action((id, options) => memoryWriteCommand('create', id, options, true));
const memoryProject = memory
  .command('project')
  .description('explicit local project/checkout bindings');
memoryProject
  .command('register <id> [directory]')
  .option('--rebind', 'explicitly accept a changed repository identity for the same project')
  .option('--dry-run', 'preview without writing (default)')
  .option('--apply', 'apply the reviewed binding')
  .option('--expect <revision>', 'required reviewed revision')
  .option('--json', 'machine-readable output')
  .action(memoryProjectCommand);
memoryProject
  .command('ls')
  .option('--json', 'machine-readable output')
  .action(memoryProjectsCommand);
const automatic = memory
  .command('auto')
  .description('project-scoped native memory sync and automatic session checkpoints');
memory
  .command('discover')
  .description('find existing client memory sources and explain their project association')
  .option('--workspace <directory>', 'checkout to inspect (default: cwd)')
  .option('--client <id>', 'filter claude-code, codex or dsh')
  .option('--json', 'machine-readable metadata without note bodies')
  .action(memoryDiscoverCommand);
memory
  .command('onboard')
  .description('preview importing existing native memory; project-matched sources by default')
  .option('--workspace <directory>', 'registered checkout (default: cwd)')
  .option('--client <id>', 'filter claude-code, codex or dsh')
  .option(
    '--source <id>',
    'explicit source ID from discovery; repeat to select several',
    (value: string, previous: string[] = []) => [...previous, value],
  )
  .option('--follow', 'also enable the project native-sync policy; hook installation is separate')
  .option('--at <timestamp>', 'timestamp captured in the reviewed command')
  .option('--dry-run', 'preview without writing (default)')
  .option('--apply', 'apply the exact reviewed import and optional follow-up policy')
  .option('--expect <revision>', 'required reviewed revision')
  .option('--json', 'machine-readable output')
  .action(memoryOnboardCommand);
function automaticOptions(command: Command) {
  return command
    .option('--workspace <directory>', 'registered checkout (default: cwd)')
    .option('--json', 'machine-readable output');
}
function automaticWriteOptions(command: Command) {
  return automaticOptions(command)
    .option('--dry-run', 'preview without writing (default)')
    .option('--apply', 'apply the reviewed automation setup or sync')
    .option('--expect <revision>', 'required reviewed revision');
}
automaticWriteOptions(
  automatic
    .command('enable')
    .description('enable scoped autosave and install project-gated lifecycle hooks'),
)
  .requiredOption('--client <id>', 'claude-code, codex or dsh')
  .option(
    '--native-dir <directory>',
    'explicit native Markdown source directory to import automatically',
  )
  .action(autoEnableCommand);
automaticWriteOptions(
  automatic
    .command('disable')
    .description('disable project automation; global hooks become no-ops for this project'),
).action(autoDisableCommand);
automaticWriteOptions(
  automatic.command('sync').description('preview native notes, duplicates and conflicts'),
)
  .option('--at <timestamp>', 'timestamp captured in the reviewed command')
  .option(
    '--resolve <id>',
    'explicitly accept the source for one conflicted record; repeat as needed',
    (value: string, previous: string[] = []) => [...previous, value],
  )
  .action(autoSyncCommand);
automaticOptions(automatic.command('status')).action(autoStatusCommand);
const conflicts = automatic
  .command('conflict')
  .description('inspect and resolve queued native or session knowledge');
automaticOptions(conflicts.command('get <id>'))
  .option('--version <hash>', 'inspect an immutable incoming history version')
  .action(autoConflictGetCommand);
automaticWriteOptions(conflicts.command('resolve <id>'))
  .requiredOption('--take <side>', 'incoming or hub; the latter also acknowledges a Hub deletion')
  .option('--at <timestamp>', 'timestamp captured in the reviewed plan')
  .action(autoConflictResolveCommand);
automaticOptions(
  automatic
    .command('watch')
    .description('foreground native memory sync while the project policy is enabled'),
)
  .option('--interval <seconds>', 'scan interval, 5–300 seconds', '30')
  .action(autoWatchCommand);
automatic
  .command('hook')
  .description('lifecycle callback; read client JSON on stdin')
  .requiredOption('--client <id>', 'source client')
  .action(autoHookCommand);
automaticOptions(
  automatic
    .command('checkpoint')
    .description('automatic capture authorized by a one-use Stop-hook token; JSON on stdin'),
)
  .requiredOption('--client <id>', 'source client')
  .requiredOption('--token <token>', 'current Stop-hook token')
  .action(autoCheckpointCommand);
memory
  .command('serve')
  .description('serve memory over MCP stdio for one registered workspace')
  .requiredOption('--workspace <directory>', 'fixed checkout binding for this server')
  .option('--include-shared', 'also allow explicitly scoped shared reads')
  .option('--allow-write', 'expose reviewed project write tools')
  .option('--allow-auto', 'expose checkpoint autosave under an explicitly enabled project policy')
  .option('--allow-shared-write', 'also allow shared writes; requires both preceding flags')
  .action(async (options) => {
    await serveMemory({
      root: hubRoot(),
      workspace: options.workspace,
      includeShared: options.includeShared,
      writable: options.allowWrite,
      automatic: options.allowAuto,
      sharedWritable: options.allowSharedWrite,
    });
  });

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
