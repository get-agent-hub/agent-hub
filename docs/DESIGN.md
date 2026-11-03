# Agent Hub design

Agent Hub is a local source of truth for MCP settings, skills and shared context across Claude Code, Codex CLI and DeepSeek Harness. Node.js ≥22.13 is required. macOS/Linux are supported targets; Windows remains experimental. The package is private until a public name/version and release are chosen.

## Principles

1. Hub stores canonical definitions; client files are explicit projections.
2. Preview changes before applying. Preserve unrelated records and personal text.
3. Capture originals and private backups before managed writes. Fail closed on stale inputs, unknown ownership and changed bindings.
4. Keep credentials local and out of generated MCP configs. Do not expose private context in plan JSON.
5. Keep client format differences in adapters and share planning/application between CLI and UI.
6. Store project context in the repository, separate from global settings and conversation history.

## Hub layout

```text
hub/
  hub.yaml
  skills/<name>/SKILL.md
  mcp/servers.yaml
  instructions/AGENTS.md
  memory/MEMORY.md
  memory/<fact>.md
  templates/repo/
  .env
  backups/
  state/
hub.recovery/
  baseline/
  artifacts/
  archives/
```

`AGENT_HUB_HOME` selects the Hub. Client path environment overrides are documented in README. Generated files and recovery metadata store local absolute bindings deliberately; recovery is not a portable cloud backup format.

## Delivery

| Area            | Source                             | Projection                                                            |
| --------------- | ---------------------------------- | --------------------------------------------------------------------- |
| MCP             | Registry plus .env references      | Native client config invoking the shared launcher                     |
| Skills          | Complete directories in Hub        | Individual links, including reviewed client-local copies              |
| Instructions    | instructions/AGENTS.md             | Owned block: Claude imports; Codex/DSH inline text                    |
| Shared memory   | memory/MEMORY.md and fact files    | Index and directory reference in the instruction block                |
| Project handoff | Hub templates or built-in defaults | AGENTS.md, PROJECT.md, NOW.md and Claude import in one Git repository |

Native auto-memory and conversation history are not merged or relocated. Shared facts are read on demand. Custom DSH profiles can disable their instruction/skill plugins; delivery does not change plugin activation.

## Services and recovery

MCP services retain their existing planner, config-preserving writer, ownership hashes and sync backups. Content services use filesystem artifacts: regular files, complete directories, final symlinks and absence. Plans include source/target fingerprints and have explicit public projections without file content.

All writes share one Hub operation lock. File/artifact transactions recheck inputs and compensate completed changes if a later write fails. Same-directory staging preserves executable modes and binary assets. Directory swaps have a short rename gap, and external clients do not honor the lock. Neither mechanism is a filesystem-wide transaction or a power-loss durability guarantee.

The immutable Hub baseline and append-only first-touch originals live outside the active Hub. Reset restores recorded originals and archives current data. Existing installations get a checkpoint of available state; unknown history cannot be recreated. See [RECOVERY.md](RECOVERY.md) and [CONTENT.md](CONTENT.md).

## Current milestone

Implemented: init, MCP import/launcher/sync/doctor, restore/reset, local UI, skills add/list/remove/import/delivery, shared rules/index delivery and init-repo templates. Every new content mutation defaults to preview and requires the reviewed revision. Plain sync retains MCP-only behavior; `--area skills` and `--area context` select the other projections.

Next is the maintainer's real working run in [WORKING_GUIDE.md](WORKING_GUIDE.md), followed by remote macOS/Linux CI, package install checks and release identity. The separate English landing page uses locale files for translation PRs; hosting is maintainer-managed and deferred.

## Later milestones

- MCP registry add/remove commands; these are still explicit stubs.
- Profiles/tags for work and personal scopes.
- OS credential stores instead of .env.
- Session indexing/search, optional memory MCP access and history-assisted handoff.
- Explicitly configured client hooks/checkpoints and background synchronization.
- Additional client adapters and independent distribution of public skills/templates.

Repository setup seeds normal files; it does not run agents, continuously update NOW.md or guarantee a model follows instructions. Windows end-to-end behavior, large-tree performance, network filesystems, ACLs/xattrs and abrupt machine-loss recovery remain separate verification work.
