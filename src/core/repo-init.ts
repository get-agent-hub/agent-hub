import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { defaultContentContext, type ContentContext } from './content-context.js';
import { readSettings } from './settings.js';
import { readOptionalText } from './file-store.js';
import { inspectArtifact } from './artifacts.js';
import { managedPlan, type ArtifactRequest, type ManagedRow } from './managed-plan.js';
import { projectBlock, hasMarkdownImport } from './managed-block.js';
import { textSource } from './context-sync.js';
import { HubError } from './errors.js';

const exec = promisify(execFile);
const DEFAULT_PROTOCOL = `## Project workflow

- At the start, read .agents/state/PROJECT.md and .agents/state/NOW.md, then inspect git status and the relevant diff. Resolve stale notes against the code and Git history.
- Keep project architecture, decisions and constraints in PROJECT.md. Keep the active task, completed work, changed files, checks actually run and next action in NOW.md.
- Update NOW.md after meaningful progress and before handing work to another agent. Never claim a check passed unless it was run.
- At handoff, state what is done, what remains, unresolved blockers and the next concrete action. Preserve existing repository rules and unrelated changes.`;
const DEFAULT_PROJECT = `# Project context

## Purpose
Not recorded yet. Describe the project's purpose and users.

## Architecture and decisions
Record durable facts verified against the repository.

## Commands and constraints
Record verified development commands and project-specific constraints.
`;
const DEFAULT_NOW = `# Current work

## Task
Not recorded yet.

## Completed
No task progress recorded by initialization.

## Changed files
Inspect git status and the diff.

## Checks
No project checks were run by init-repo.

## Next action
Record the current task, verify PROJECT.md against the code and continue from the actual repository state.
`;
interface RepoOwnership {
  version: 1;
  entries: { root: string; protocolHash: string }[];
}

export async function planRepoInit(directory = process.cwd(), supplied?: ContentContext) {
  const context = supplied ?? (await defaultContentContext());
  await readSettings(context.root);
  let root;
  try {
    root = await fs.realpath(
      (
        await exec('git', ['rev-parse', '--show-toplevel'], {
          cwd: path.resolve(directory),
          timeout: 3000,
        })
      ).stdout.trim(),
    );
  } catch {
    throw new HubError(
      'Run init-repo inside an existing Git repository. It does not create or modify Git history.',
    );
  }
  if (root === path.parse(root).root || root === os.homedir())
    throw new HubError(
      'Choose a dedicated project repository instead of the filesystem or home root.',
    );
  const statePath = path.join(context.root, 'state', 'repositories.json');
  const stateBefore = await inspectArtifact(statePath);
  if (!['file', 'missing'].includes(stateBefore.kind))
    throw new HubError('Repository ownership must be a regular file.');
  const stateText = await readOptionalText(statePath);
  let state: RepoOwnership;
  try {
    state = stateText === null ? { version: 1, entries: [] } : JSON.parse(stateText);
    if (
      state.version !== 1 ||
      !Array.isArray(state.entries) ||
      state.entries.some(
        (entry) => !path.isAbsolute(entry.root) || !/^[a-f0-9]{64}$/.test(entry.protocolHash),
      ) ||
      new Set(state.entries.map((entry) => entry.root)).size !== state.entries.length
    )
      throw new Error();
  } catch {
    throw new HubError('Cannot parse repository ownership state.');
  }
  const names = ['AGENTS.md', '.agents/state/PROJECT.md', '.agents/state/NOW.md', 'CLAUDE.md'];
  const templates = await Promise.all(
    names.map((name) => textSource(path.join(context.root, 'templates', 'repo', name))),
  );
  const sources = templates.flatMap((template) => template.sources);
  const rows: ManagedRow[] = [];
  const requests: ArtifactRequest[] = [];
  const agents = await inspectArtifact(path.join(root, 'AGENTS.md'));
  const previous = state.entries.find((entry) => entry.root === root);
  let protocolHash = previous?.protocolHash;
  if (!['file', 'missing'].includes(agents.kind))
    rows.push({
      path: agents.path,
      client: 'repository',
      name: 'AGENTS.md',
      action: 'conflict',
      note: 'Existing instruction symlinks or directories are preserved; resolve the target before initializing.',
    });
  else {
    try {
      const current = await readOptionalText(agents.path);
      const projection = projectBlock(
        current ?? '',
        'repo',
        templates[0]!.content?.trim() || DEFAULT_PROTOCOL,
        previous?.protocolHash,
      );
      protocolHash = projection.blockHash;
      rows.push({
        path: agents.path,
        client: 'repository',
        name: 'AGENTS.md',
        action:
          projection.next === (current ?? '')
            ? 'keep'
            : agents.kind === 'missing'
              ? 'add'
              : 'replace',
        note: 'Adds only the project workflow block; existing rules remain intact.',
      });
      if (projection.next !== (current ?? ''))
        requests.push({
          before: agents,
          client: 'repository',
          value: {
            kind: 'file',
            content: projection.next,
            mode: agents.kind === 'file' ? agents.mode : 0o644,
          },
        });
    } catch (error) {
      rows.push({
        path: agents.path,
        client: 'repository',
        name: 'AGENTS.md',
        action: 'conflict',
        note: error instanceof HubError ? error.message : 'Cannot project the repository protocol.',
      });
    }
  }
  for (const [index, fallback] of [
    [1, DEFAULT_PROJECT],
    [2, DEFAULT_NOW],
  ] as const) {
    const name = names[index]!;
    const before = await inspectArtifact(path.join(root, name));
    rows.push({
      path: before.path,
      client: 'repository',
      name,
      action: before.kind === 'missing' ? 'add' : 'preserve',
      note: 'Existing project/task notes are never regenerated or overwritten.',
    });
    if (before.kind === 'missing')
      requests.push({
        before,
        client: 'repository',
        value: { kind: 'file', content: templates[index]!.content ?? fallback, mode: 0o644 },
      });
  }
  const claude = await inspectArtifact(path.join(root, 'CLAUDE.md'));
  if (
    claude.kind === 'symlink' &&
    (await fs.realpath(claude.path).then(
      (resolved) => resolved === agents.physicalPath,
      () => false,
    ))
  )
    rows.push({
      path: claude.path,
      client: 'repository',
      name: 'CLAUDE.md',
      action: 'keep',
      note: 'Already links to AGENTS.md.',
    });
  else if (!['file', 'missing'].includes(claude.kind))
    rows.push({
      path: claude.path,
      client: 'repository',
      name: 'CLAUDE.md',
      action: 'conflict',
      note: 'Existing instruction binding is preserved; add the AGENTS.md import manually.',
    });
  else {
    const current = await readOptionalText(claude.path);
    const base = current ?? templates[3]!.content ?? '';
    const importsAgents = hasMarkdownImport(base, 'AGENTS.md');
    const next = importsAgents
      ? base
      : base + (base && !base.endsWith('\n') ? '\n' : '') + '@AGENTS.md\n';
    rows.push({
      path: claude.path,
      client: 'repository',
      name: 'CLAUDE.md',
      action: next === current ? 'keep' : claude.kind === 'missing' ? 'add' : 'replace',
      note: 'Adds @AGENTS.md without replacing Claude-specific rules.',
    });
    if (next !== current)
      requests.push({
        before: claude,
        client: 'repository',
        value: { kind: 'file', content: next, mode: claude.kind === 'file' ? claude.mode : 0o644 },
      });
  }
  if (protocolHash) {
    const entries = [
      ...state.entries.filter((entry) => entry.root !== root),
      { root, protocolHash },
    ].sort((left, right) => left.root.localeCompare(right.root));
    const next = JSON.stringify({ version: 1, entries }, null, 2) + '\n';
    if (next !== stateText)
      requests.push({
        before: stateBefore,
        client: 'hub',
        value: { kind: 'file', content: next, mode: 0o600 },
      });
  }
  return managedPlan(
    { root: context.root, rows, requests, sources, command: ['init-repo', root] },
    { repository: root, stateBefore, context },
  );
}
