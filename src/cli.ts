#!/usr/bin/env node
import { Command, Option } from 'commander';
import { configureCliHelp } from './commands/catalog.js';
import {
  repoInitCommand,
  runManaged,
  skillAddCommand,
  skillListCommand,
  skillRemoveCommand,
} from './commands/content.js';
import { doctorCommand } from './commands/doctor.js';
import { importCommand } from './commands/import.js';
import { initCommand } from './commands/init.js';
import { registerHistoryCommands } from './commands/history.js';
import { mcpLsCommand, mcpRunCommand } from './commands/mcp.js';
import {
  autoCheckpointCommand,
  autoConflictGetCommand,
  autoConflictResolveCommand,
  autoDisableCommand,
  autoEnableCommand,
  autoHookCommand,
  autoStatusCommand,
  autoSyncCommand,
  autoWatchCommand,
} from './commands/memory-auto.js';
import { memoryDiscoverCommand, memoryOnboardCommand } from './commands/memory-onboarding.js';
import {
  memoryGetCommand,
  memoryListCommand,
  memoryProjectCommand,
  memoryProjectsCommand,
  memoryWriteCommand,
} from './commands/memory.js';
import { projectConnectCommand, quickCommand } from './commands/quick.js';
import { resetCommand } from './commands/reset.js';
import { statusCommand } from './commands/status.js';
import { notImplemented } from './commands/stub.js';
import { restoreCommand, syncCommand } from './commands/sync.js';
import { uiCommand } from './commands/ui.js';
import { undoCommand } from './commands/undo.js';
import { planProjectDisconnect } from './core/projects/disconnect.js';
import { serveMemory } from './mcp/memory.js';
import { serveHistory } from './mcp/history.js';
import { packageVersion } from './shared/package.js';
import { hubRoot } from './shared/paths.js';

const program = new Command();

program
  .name('ahub')
  .description(
    'Manage shared tools, skills and instructions across your AI coding clients, with optional project memory.',
  )
  .version(packageVersion)
  .option('--advanced', 'show all supported command groups and technical options');

program
  .command('quick')
  .addOption(new Option('--workspace <directory>').hideHelp())
  .option(
    '--client <ids>',
    'comma-separated detected clients (default: all enabled detected clients)',
  )
  .option('--prefer <id>', 'explicit source preference when imported client copies differ')
  .addOption(new Option('--no-project').hideHelp())
  .addOption(new Option('--no-automation').hideHelp())
  .option('--at <timestamp>', 'timestamp captured in the reviewed quick command')
  .option('--interactive', 'preview, then confirm this same plan in the terminal')
  .option('--dry-run', 'show the plan without prompting or writing')
  .option('--apply', 'run the reviewed staged workflow with existing recovery protections')
  .option('--expect <revision>', 'required reviewed workflow revision')
  .option('--json', 'machine-readable preview or per-stage result')
  .action((options) => quickCommand({ ...options, advanced: program.opts().advanced }));

const project = program.command('project');
project
  .command('connect [directory]')
  .option(
    '--client <ids>',
    'comma-separated detected clients for project memory (default: all enabled detected clients)',
  )
  .option('--no-automation', 'import project memory and prepare handoff without enabling hooks')
  .option('--at <timestamp>', 'timestamp captured in the reviewed connection command')
  .option('--interactive', 'preview, then confirm this same project connection')
  .option('--dry-run', 'show the plan without writing')
  .option('--apply', 'apply the reviewed project connection')
  .option('--expect <revision>', 'required reviewed connection revision')
  .option('--json', 'machine-readable preview or per-stage result')
  .action((directory, options) =>
    projectConnectCommand(directory, { ...options, advanced: program.opts().advanced }),
  );

project
  .command('disconnect <id>')
  .option('--dry-run', 'show the plan without writing')
  .option('--apply', 'apply the exact reviewed disconnection')
  .option('--expect <revision>', 'required reviewed revision')
  .option('--json', 'machine-readable output')
  .action((id, options) =>
    runManaged(() => planProjectDisconnect(hubRoot(), id), { ...options, terminalDefault: true }),
  );

program
  .command('undo')
  .argument('[run]', 'recorded workflow ID or latest', 'latest')
  .option('--dry-run', 'show the plan without writing')
  .option('--apply', 'restore this workflow snapshot and archive current data')
  .option('--expect <revision>', 'required exact reviewed undo revision')
  .option('--json', 'machine-readable output')
  .action(undoCommand);

program.command('status').option('--json', 'machine-readable output').action(statusCommand);

program
  .command('init')
  .option('-y, --yes', 'accept defaults, no questions')
  .option('--remote <url>', 'git remote to add')
  .option('--no-git', 'do not track the hub in git')
  .action(initCommand);
program
  .command('sync')
  .option('--apply', 'write changes (with backup)')
  .option('--dry-run', 'show changes and exact commands, write nothing (default)')
  .option('--client <id>', 'only this client')
  .option(
    '--only <name...>',
    'deliver only these exact MCP or skill names; preserve all other entries',
  )
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
  .option('--interactive', 'preview MCP import, then confirm this same plan in the terminal')
  .option('--dry-run', 'show the plan, write nothing')
  .option('--apply', 'apply a reviewed MCP or skills import')
  .option('--expect <revision>', 'required exact reviewed import revision')
  .option(
    '--prefer <clients>',
    'explicit source preference when client definitions differ; no default winner',
  )
  .option('--source <id>', 'read definitions from this client only')
  .option('--overwrite', 'replace servers that already exist in the hub')
  .option('--json', 'machine-readable output')
  .action(importCommand);
program
  .command('doctor [name]')
  .option('--timeout <seconds>', 'total time limit per server (0.1–120)', '20')
  .option('--client <id>', 'check only the servers enabled for this client')
  .option('--json', 'machine-readable report without raw server logs')
  .action(doctorCommand);
program
  .command('init-repo [directory]')
  .option('--dry-run', 'show the plan without writing')
  .option('--apply', 'apply the reviewed repository setup')
  .option('--expect <revision>', 'required reviewed revision')
  .option('--json', 'machine-readable output')
  .action(repoInitCommand);
program
  .command('restore <backup>')
  .option('--apply', 'restore original files')
  .option('--dry-run', 'show rollback without writing (default)')
  .option('--expect <revision>', 'apply only if this reviewed revision still matches')
  .option('--json', 'machine-readable output')
  .action(restoreCommand);

program
  .command('reset')
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

const mcp = program.command('mcp');
mcp.command('ls').option('--json').action(mcpLsCommand);
mcp.command('add <name>', { hidden: true }).action(notImplemented('mcp add'));
mcp.command('rm <name>', { hidden: true }).action(notImplemented('mcp rm'));
mcp.command('run <name>').action(mcpRunCommand);

const skill = program.command('skill');
skill.command('ls').option('--json', 'machine-readable output').action(skillListCommand);
skill
  .command('add <source>')
  .option('--name <name>', 'hub skill name')
  .option('--overwrite', 'explicitly replace an existing hub skill')
  .option('--dry-run', 'show the plan without writing')
  .option('--apply', 'apply the reviewed plan')
  .option('--expect <revision>', 'required reviewed revision')
  .option('--json', 'machine-readable output')
  .action(skillAddCommand);
skill
  .command('rm <name>')
  .option('--dry-run', 'show the plan without writing')
  .option('--apply', 'apply the reviewed plan')
  .option('--expect <revision>', 'required reviewed revision')
  .option('--json', 'machine-readable output')
  .action(skillRemoveCommand);

const memory = program.command('memory');
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
    .option('--dry-run', 'show the plan without writing')
    .option('--apply', 'apply the reviewed operation with a backup')
    .option('--expect <revision>', 'required reviewed plan revision');
}
memoryScope(memory.command('ls'))
  .option('--limit <count>', 'maximum results, 1–100', '50')
  .action((options) => memoryListCommand('', options));
memoryScope(memory.command('search <query>'))
  .option('--limit <count>', 'maximum results, 1–100', '50')
  .action(memoryListCommand);
memoryScope(memory.command('get <id>')).action(memoryGetCommand);
for (const [name, operation] of [
  ['add', 'create'],
  ['update', 'update'],
  ['rm', 'delete'],
] as const)
  memoryWriteOptions(memory.command(`${name} <id>`)).action((id, options) =>
    memoryWriteCommand(operation, id, options),
  );
memoryWriteOptions(memory.command('import <id>')).action((id, options) =>
  memoryWriteCommand('create', id, options, true),
);
const memoryProject = memory.command('project');
memoryProject
  .command('register <id> [directory]')
  .option('--rebind', 'explicitly accept a changed repository identity for the same project')
  .option('--dry-run', 'show the plan without writing')
  .option('--apply', 'apply the reviewed binding')
  .option('--expect <revision>', 'required reviewed revision')
  .option('--json', 'machine-readable output')
  .action(memoryProjectCommand);
memoryProject
  .command('ls')
  .option('--json', 'machine-readable output')
  .action(memoryProjectsCommand);
const automatic = memory.command('auto');
memory
  .command('discover')
  .option('--workspace <directory>', 'checkout to inspect (default: cwd)')
  .option('--client <id>', 'filter claude-code, codex or dsh')
  .option('--json', 'machine-readable metadata without note bodies')
  .action(memoryDiscoverCommand);
memory
  .command('onboard')
  .option('--workspace <directory>', 'registered checkout (default: cwd)')
  .option('--client <id>', 'filter claude-code, codex or dsh')
  .option(
    '--source <id>',
    'explicit source ID from discovery; repeat to select several',
    (value: string, previous: string[] = []) => [...previous, value],
  )
  .option('--follow', 'also enable the project native-sync policy; hook installation is separate')
  .option('--at <timestamp>', 'timestamp captured in the reviewed command')
  .option('--dry-run', 'show the plan without writing')
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
    .option('--dry-run', 'show the plan without writing')
    .option('--apply', 'apply the reviewed automation setup or sync')
    .option('--expect <revision>', 'required reviewed revision');
}
automaticWriteOptions(automatic.command('enable'))
  .requiredOption('--client <id>', 'claude-code, codex or dsh')
  .option(
    '--native-dir <directory>',
    'explicit native Markdown source directory to import automatically',
  )
  .action(autoEnableCommand);
automaticWriteOptions(automatic.command('disable')).action(autoDisableCommand);
automaticWriteOptions(automatic.command('sync'))
  .option('--at <timestamp>', 'timestamp captured in the reviewed command')
  .option(
    '--resolve <id>',
    'explicitly accept the source for one conflicted record; repeat as needed',
    (value: string, previous: string[] = []) => [...previous, value],
  )
  .action(autoSyncCommand);
automaticOptions(automatic.command('status')).action(autoStatusCommand);
const conflicts = automatic.command('conflict');
automaticOptions(conflicts.command('get <id>'))
  .option('--version <hash>', 'inspect an immutable incoming history version')
  .action(autoConflictGetCommand);
automaticWriteOptions(conflicts.command('resolve <id>'))
  .requiredOption('--take <side>', 'incoming or hub; the latter also acknowledges a Hub deletion')
  .option('--at <timestamp>', 'timestamp captured in the reviewed plan')
  .action(autoConflictResolveCommand);
automaticOptions(automatic.command('watch'))
  .option('--interval <seconds>', 'scan interval, 5–300 seconds', '30')
  .action(autoWatchCommand);
automatic.command('hook').requiredOption('--client <id>', 'source client').action(autoHookCommand);
automaticOptions(automatic.command('checkpoint'))
  .requiredOption('--client <id>', 'source client')
  .requiredOption('--token <token>', 'current Stop-hook token')
  .action(autoCheckpointCommand);
memory
  .command('serve')
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
  .option('--port <number>', 'local port (0 picks a free port)', '3082')
  .option('--no-open', 'do not open a browser automatically')
  .action(uiCommand);

registerHistoryCommands(program, serveHistory);
configureCliHelp(program);
program.action(() => program.outputHelp());

program.parseAsync().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
