import { Help, type Command } from 'commander';

export type CommandLevel = 'everyday' | 'advanced' | 'integration';
export interface CommandGuide {
  command: string;
  level: CommandLevel;
  audience: string;
  purpose: string;
}
const entry = (
  command: string,
  level: CommandLevel,
  audience: string,
  purpose: string,
): CommandGuide => ({ command, level, audience, purpose });

/** Human-facing purpose and caller, shared by CLI help and the generated reference. */
export const commandGuide: CommandGuide[] = [
  entry(
    'quick',
    'everyday',
    'Developers setting up or updating shared client settings.',
    'Collect and deliver shared MCP, skills and instructions; no project is required.',
  ),
  entry(
    'ui',
    'everyday',
    'Users who prefer guided previews and visual conflict resolution.',
    'Open the local interface to manage Hub, projects, memory and conflicts.',
  ),
  entry(
    'status',
    'everyday',
    'Users inspecting their setup without starting MCP servers.',
    'Show configuration differences, cached connection evidence and observed memory activity.',
  ),
  entry(
    'doctor',
    'everyday',
    'Users troubleshooting tools and support engineers.',
    'Start real MCP checks to verify connections and tool discovery; never invoke tools.',
  ),
  entry(
    'project',
    'everyday',
    'Developers who want optional memory and handoff for a Git project.',
    'Connect or disconnect project memory separately from shared Hub settings.',
  ),
  entry(
    'project connect',
    'everyday',
    'Developers onboarding or reconnecting one Git checkout.',
    'Bind project memory, collect matched notes and prepare handoff files and optional hooks.',
  ),
  entry(
    'project disconnect',
    'everyday',
    'Developers stopping memory automation for a registered project.',
    'Disconnect all project checkouts and pending checkpoints while retaining knowledge and notes.',
  ),
  entry(
    'undo',
    'everyday',
    'Users reversing a recorded quick or project-connect workflow.',
    'Preview rollback of one setup workflow; later changes block it. This is not universal last-action undo.',
  ),
  entry(
    'init',
    'advanced',
    'Maintainers adopting a Hub layout or configuring its local Git history.',
    'Prepare Hub files and optional Git history without collecting or delivering client settings.',
  ),
  entry(
    'import',
    'advanced',
    'Terminal users and scripts choosing exact client sources.',
    'Preview collecting selected MCP definitions or complete skill bundles into Hub.',
  ),
  entry(
    'sync',
    'advanced',
    'Terminal users and scripts delivering a specific area or item.',
    'Preview delivery from Hub to clients: MCP by default, or explicit skills/context areas.',
  ),
  entry(
    'init-repo',
    'advanced',
    'Developers who need handoff files without project memory.',
    'Prepare AGENTS.md and project/task notes in one existing Git repository.',
  ),
  entry(
    'restore',
    'advanced',
    'Users and support engineers reversing one recorded stage.',
    'Preview restoring one sync/content backup; changed files or ownership can block it.',
  ),
  entry(
    'reset',
    'advanced',
    'Maintainers returning recorded paths to their first baseline.',
    'Preview restoring the first Hub/client baseline and archiving current data; broader than undo.',
  ),
  entry(
    'skill',
    'advanced',
    'Terminal users and scripts managing exact skill bundles.',
    'List, copy or remove canonical Hub skills independently of client delivery.',
  ),
  entry(
    'skill ls',
    'advanced',
    'Terminal users and inventory scripts.',
    'List canonical Hub skill bundles and their local state.',
  ),
  entry(
    'skill add',
    'advanced',
    'Users importing a deliberately chosen local bundle.',
    'Preview copying a complete local skill into Hub without executing its scripts.',
  ),
  entry(
    'skill rm',
    'advanced',
    'Users retiring a canonical skill.',
    'Preview removing a Hub skill with a recoverable backup; delivery is separate.',
  ),
  entry(
    'mcp',
    'advanced',
    'Integration developers and focused inventory scripts.',
    'Inspect the registry or access the launcher used by native clients.',
  ),
  entry(
    'mcp ls',
    'advanced',
    'Terminal users and focused MCP inventory scripts.',
    'List servers stored in the Hub registry without launching them.',
  ),
  entry(
    'mcp run',
    'integration',
    'Native clients through generated launcher configurations; manual debugging when needed.',
    'Launch one registry server over stdio with credentials resolved from Hub.',
  ),
  entry(
    'memory',
    'advanced',
    'Terminal users, scripts and integration developers managing scoped knowledge.',
    'Inspect or manage records, native-source import, project bindings and memory integrations.',
  ),
  entry(
    'memory ls',
    'advanced',
    'Terminal users and record inventory scripts.',
    'List canonical records in one explicitly selected shared or project scope.',
  ),
  entry(
    'memory search',
    'advanced',
    'Terminal users retrieving relevant durable knowledge.',
    'Search record titles, tags and bodies in one scope; no embeddings or model call.',
  ),
  entry(
    'memory get',
    'advanced',
    'Terminal users reading a known record or preparing a revision-checked update.',
    'Read one record and its current revision.',
  ),
  entry(
    'memory add',
    'advanced',
    'Terminal users creating one deliberate durable fact.',
    'Preview creating one scoped record and updating its owned index.',
  ),
  entry(
    'memory update',
    'advanced',
    'Terminal users editing an existing verified record.',
    'Preview a revision-checked record update; omitted metadata is retained.',
  ),
  entry(
    'memory rm',
    'advanced',
    'Terminal users deliberately retiring a record.',
    'Preview a revision-checked record deletion with a recoverable backup.',
  ),
  entry(
    'memory import',
    'advanced',
    'Users selecting local text to retain as one record.',
    'Preview copying one UTF-8 note into scoped memory while preserving its source.',
  ),
  entry(
    'memory project',
    'advanced',
    'Maintainers handling explicit IDs, multiple checkouts or identity recovery.',
    'Inspect or deliberately register project/checkout bindings beyond normal project connect.',
  ),
  entry(
    'memory project register',
    'advanced',
    'Maintainers sharing a project ID or approving a changed Git identity.',
    'Preview binding a verified checkout to an explicit project ID; rebind requires an explicit choice.',
  ),
  entry(
    'memory project ls',
    'advanced',
    'Users inspecting local checkout bindings.',
    'List registered project IDs and checkout metadata.',
  ),
  entry(
    'memory discover',
    'advanced',
    'Users reviewing unusual or unresolved native memory sources.',
    'Find client memory sources and explain their format and project association without importing bodies.',
  ),
  entry(
    'memory onboard',
    'advanced',
    'Users deliberately importing selected existing native Markdown.',
    'Preview initial native-memory import and optionally attach selected sources for future imports.',
  ),
  entry(
    'memory auto',
    'advanced',
    'Users configuring project automation or troubleshooting its policy.',
    'Manage project-gated native imports, session checkpoints and queued knowledge conflicts.',
  ),
  entry(
    'memory auto enable',
    'advanced',
    'Users choosing automation for a particular project/client.',
    'Preview enabling project autosave and installing reviewed native lifecycle hooks.',
  ),
  entry(
    'memory auto disable',
    'advanced',
    'Users stopping project autosave while retaining knowledge.',
    'Preview disabling the project policy; shared hook handlers remain installed.',
  ),
  entry(
    'memory auto sync',
    'advanced',
    'Users reviewing configured native-note changes independently of client events.',
    'Preview importing native Markdown updates, duplicates and conflicts.',
  ),
  entry(
    'memory auto status',
    'advanced',
    'Users and support inspecting automation evidence.',
    'Inspect policy, source issues, conflicts, pending tokens and recent callback/checkpoint metadata.',
  ),
  entry(
    'memory auto watch',
    'advanced',
    'Users who explicitly want a foreground native-note watcher.',
    'Watch configured native sources while project automation is enabled; no OS service is installed.',
  ),
  entry(
    'memory auto conflict',
    'advanced',
    'Users reviewing conflicting incoming knowledge.',
    'Inspect queued incoming versions and choose an explicit resolution.',
  ),
  entry(
    'memory auto conflict get',
    'advanced',
    'Users comparing incoming knowledge with Hub records.',
    'Read one pending conflict or an immutable incoming history version.',
  ),
  entry(
    'memory auto conflict resolve',
    'advanced',
    'Users deciding whether incoming knowledge or Hub should win.',
    'Preview accepting incoming knowledge or acknowledging the current Hub value/deletion.',
  ),
  entry(
    'memory auto hook',
    'integration',
    'Native lifecycle handlers installed in client configuration.',
    'Read the native event from stdin and run its project-gated callback.',
  ),
  entry(
    'memory auto checkpoint',
    'integration',
    'The active client agent responding to a one-use Stop-hook capability.',
    'Submit evidenced project facts or an empty acknowledgement under the enabled policy.',
  ),
  entry(
    'memory serve',
    'integration',
    'A native MCP connection configured for one fixed project.',
    'Serve scoped memory over MCP stdio; read, reviewed-write and automatic capabilities are separately enabled.',
  ),
];

const everyday = ['quick', 'ui', 'status', 'doctor', 'project', 'undo'];
const technicalOptions: Record<string, string[]> = {
  quick: ['--client', '--prefer', '--at', '--interactive', '--apply', '--expect', '--json'],
  'project connect': ['--client', '--at', '--interactive', '--apply', '--expect', '--json'],
  'project disconnect': ['--apply', '--expect', '--json'],
  undo: ['--apply', '--expect', '--json'],
};

export function configureCliHelp(program: Command) {
  const base = new Help();
  const paths = new Map<Command, string>([[program, '']]);
  const guides = new Map(commandGuide.map((guide) => [guide.command, guide]));
  function visit(parent: Command, prefix = '') {
    for (const command of parent.commands) {
      const name = [prefix, command.name()].filter(Boolean).join(' ');
      paths.set(command, name);
      const guide = guides.get(name);
      // Unimplemented compatibility stubs stay permanently hidden.
      if (!guide) {
        if (['mcp add', 'mcp rm'].includes(name)) continue;
        throw new Error(`Missing command purpose: ${name}`);
      }
      command.description(guide.purpose);
      command.addHelpText(
        'after',
        `\nUsed by: ${guide.audience}\nMore options: ahub --advanced ${name} --help`,
      );
      if (parent === program)
        command.helpGroup(guide.level === 'everyday' ? 'Everyday commands:' : 'Advanced commands:');
      visit(command, name);
    }
  }
  visit(program);
  const advanced = () => program.opts<{ advanced?: boolean }>().advanced === true;
  program.configureHelp({
    visibleCommands(command) {
      const visible = base.visibleCommands(command);
      if (command !== program || advanced()) return visible;
      return visible
        .filter((child) => everyday.includes(child.name()))
        .sort((a, b) => everyday.indexOf(a.name()) - everyday.indexOf(b.name()));
    },
    visibleOptions(command) {
      const hidden = technicalOptions[paths.get(command) ?? ''] ?? [];
      return base
        .visibleOptions(command)
        .filter((option) => advanced() || !hidden.includes(option.long ?? ''));
    },
  });
  for (const command of paths.keys()) command.configureHelp(program.configureHelp());
  program.addHelpText(
    'after',
    '\nStart with ahub quick for guided terminal setup, or ahub ui for the local interface.\nOptional project memory: ahub project connect /path/to/project.\nFull command catalog: ahub --advanced --help. Existing script and runtime commands remain available.',
  );
}

export function commandReference() {
  const introduction =
    '# Command reference\n\nStart with `ahub quick` for terminal setup or `ahub ui` for the local interface. `ahub` and `ahub --help` show six everyday command groups. Use `ahub --advanced --help` for all groups, or `ahub --advanced COMMAND --help` for technical options. Existing commands, JSON contracts and generated runtime calls remain supported.\n\nIn a terminal, quick and project connection show their plan and ask before applying. Explicit `--dry-run`, `--json` and noninteractive calls preview without writing. Script applies require the exact reviewed revision and timestamp where applicable.\n';
  const sections: [CommandLevel, string][] = [
    ['everyday', 'Everyday commands'],
    ['advanced', 'Advanced operations'],
    ['integration', 'Client and runtime integration'],
  ];
  return (
    introduction +
    sections
      .map(
        ([level, title]) =>
          `## ${title}\n\n| Command | Who uses it | Purpose |\n| --- | --- | --- |\n${commandGuide
            .filter((guide) => guide.level === level)
            .map((guide) => `| \`ahub ${guide.command}\` | ${guide.audience} | ${guide.purpose} |`)
            .join('\n')}\n`,
      )
      .join('\n') +
    '\nIntegration commands are normally invoked by configured clients or callbacks, not typed during ordinary setup. `undo` reverses a recorded setup workflow, `restore` reverses one stage, and `reset` returns to the first baseline. Repointed bindings and later changes can block recovery; use each current preview.\n'
  );
}
