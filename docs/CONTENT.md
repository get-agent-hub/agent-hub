# Skills, shared context and repository handoff

These features use the same local Hub lock as MCP operations. Every new mutating command defaults to preview. Apply requires `--apply --expect <revision>` from a fresh plan. Known originals and private backups are captured before writing. No command downloads or executes a skill's scripts during import or delivery.

## Skills

```sh
ahub skill ls --json
ahub skill add /path/to/my-skill --dry-run
ahub import skills --dry-run
ahub import skills:my-skill --prefer codex --dry-run
ahub sync --area skills --dry-run
ahub sync --area skills --client codex --replace=my-skill --dry-run
ahub skill rm my-skill --dry-run
```

`skill add` copies a local directory into `hub/skills/<name>`. It includes binary assets, references and executable modes without running code. A `SKILL.md` path is also accepted. `--name` chooses the directory alias; it does not rewrite the skill's metadata. Keep that metadata consistent with the intended catalog name. `--overwrite` explicitly permits replacing an existing Hub copy. Remote URLs are rejected: use a trusted external skills installer, then import its local result.

Import reads enabled clients' primary and additional user skill roots. Different copies require an explicit `--prefer`; an existing Hub skill stays unchanged unless `--overwrite` is selected. Import preserves client directories. CLI source preferences for MCP retain their previous default; skills have no implicit winner for differing copies.

Delivery creates individual links instead of replacing the entire shared skills directory. Claude uses its user skills root. Codex and DSH normally share `.agents/skills`; DSH also respects `DSH_AGENTS_HOME`. Existing client-local copies in additional roots are checked too: identical copies become links, different copies conflict unless exact replacements are reviewed for one client. This prevents a stale higher-priority local directory from silently shadowing the shared original. A shared physical target is written once and lists every affected client. A disabled client sharing the target blocks changes there.

Existing links whose target directory exactly matches the Hub bundle are also equivalent. Preview can migrate them to the canonical Hub link while retaining their original binding; import keeps an already equivalent linked Hub original. Changes to those source directories invalidate a reviewed migration. Unrelated client skills are preserved. Removing a Hub skill does not immediately change clients: the next skills sync removes only unchanged, previously owned links. Hand-edited or repointed links remain conflicts. Application-hidden roots such as `.system` are excluded from discovery.

Claude's account-managed `synced` and `anthropic-skills` namespaces are skipped. Project, plugin and administrator skill scopes remain client-owned, as do visibility settings such as Codex `skills.config`. A linked file does not prove that the client has enabled or invoked that skill; verify its actual catalog during the working run.

Nested relative links must stay within the imported bundle and resolve successfully. Absolute or escaping links are rejected rather than copied with changed meaning. Names that collide by case are rejected for portability. Before Codex delivery, YAML `name` and `description` are required in `SKILL.md`; a legacy Claude-only body can still be stored and delivered to Claude.

## Instructions and shared memory

Place common rules in `hub/instructions/AGENTS.md`. [Memory operations](MEMORY.md) maintain structured shared/project records and an owned shared index block in `hub/memory/MEMORY.md`; existing hand-written index text and fact files remain separate and readable.

```sh
ahub sync --area context --dry-run
ahub sync --area context --client codex --dry-run
```

The target files are Claude's user `CLAUDE.md`, Codex's global `AGENTS.md` and DSH's home `AGENTS.md`. Claude receives escaped `@` imports of the Hub source files. Codex and DSH receive the rules and index text with the shared memory directory explicitly identified. Agents can read relevant fact files on demand. This is shared context delivery, not a merge or relocation of client-native automatic memory. Existing native memory, conversations and hooks stay separate.

Only a marked, owned block is updated; text outside it stays byte-for-byte intact. Changes inside the block, missing/duplicate markers and unknown ownership block updates. A non-empty Codex `AGENTS.override.md` blocks delivery because it shadows the global file. Instruction target symlinks and directories are preserved and require explicit manual resolution. Shared source files may be symlinks, but recursive source/target overlap is rejected. Generated instruction files have a conservative 32 KiB delivery budget; shortening the source is required if exceeded.

When both sources disappear or become empty, sync removes its own block. It removes a newly created instruction file only if no personal text remains. UI previews contain actions and paths, never the source rules or memory text.

## Repository setup

```sh
ahub init-repo --dry-run
ahub init-repo /path/to/repository --dry-run
```

Run inside an existing Git repository with an initialized Hub. The command locates the repository root, including from a subdirectory. It does not initialize Git, stage files or commit work.

| File                       | Purpose                                            | Existing content                                          |
| -------------------------- | -------------------------------------------------- | --------------------------------------------------------- |
| `AGENTS.md`                | Shared project protocol for every agent            | Append/update only its owned workflow block               |
| `.agents/state/PROJECT.md` | Durable architecture, decisions and constraints    | Preserve; never regenerate                                |
| `.agents/state/NOW.md`     | Active task, progress, real checks and next action | Preserve; never regenerate                                |
| `CLAUDE.md`                | Explicit `@AGENTS.md` import                       | Preserve personal text and avoid duplicate active imports |

Default notes explicitly say that project facts and task progress are not recorded yet. Init-repo does not infer an architecture or claim that checks passed. Files are normal repository files and can be committed with the branch. Optional templates under `hub/templates/repo/` use these same relative paths. A `CLAUDE.md` already linking to `AGENTS.md` is preserved. Other instruction symlinks require review.

The local UI exposes Skills import/delivery, context delivery on Instructions/Memory, scoped memory record management and Prepare repository on Repos & tasks. Repository setup and project memory are bound to the selected verified registered project or the startup folder; HTTP requests cannot choose an arbitrary directory. Changing selection expires all previews. Preview IDs expire after five minutes, are single-use and reject changed inputs.

## Recovery and limitations

Content operations print a `content-…` backup ID. Use normal `restore <id> --dry-run` to review its rollback. A restore itself retains another backup. Changed files, directories or bindings block stale restores.

Reset also restores first-touch originals for client skills and project/context files. Artifact originals live in `<AGENT_HUB_HOME>.recovery/artifacts/`, outside the active Hub. They may contain personal text or credentials and are not encrypted. Corrupt payloads, foreign recovery links and changed bindings block recovery. `--archive-changes` preserves externally edited regular files/directories before restoring; repointed symlinks remain blocked.

File and directory replacement uses same-directory staging and compensating rollback. A directory swap has a brief rename gap; it is not a filesystem-wide atomic transaction. External clients do not honor the Hub lock. Crash recovery uses durable before/after intent, but power-loss durability, ACL/xattr preservation and Windows end-to-end behavior remain outside the verified contract. Interrupted cleanup may retain `.agent-hub-*.old`/`.new` staging paths; preserve them for manual recovery if reported rather than deleting unknown data.

## Client contracts checked

- [Codex instruction discovery](https://learn.chatgpt.com/docs/agent-configuration/agents-md) and [skill metadata/discovery](https://learn.chatgpt.com/docs/build-skills).
- [Claude instruction imports](https://code.claude.com/docs/en/memory) and [skills](https://code.claude.com/docs/en/skills).
- [DSH global instructions](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/context/agent-instructions/README.md) and [filesystem skill roots](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/skill/skill-filesystem/README.md). Custom DSH profiles can disable these plugins; delivery does not enable them automatically.

## One item, one direction

Use `import skills:NAME --source CLIENT --overwrite` to accept exactly one selected client bundle into Hub, or `sync --area skills --client CLIENT --only=NAME --replace=NAME` to deliver Hub to that client. MCP uses the same source/item contract with `import mcp:NAME` and `sync --only=NAME`. Both preview first and require exact reviewed application. `--only` also preserves ownership of unselected entries; shared physical skill roots still list all affected clients and protect disabled clients. UI detail panels provide these two directions directly.
