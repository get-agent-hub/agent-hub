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
  memory/shared/records/<id>.md
  memory/projects/<project-id>/records/<id>.md
  memory/projects/<project-id>/MEMORY.md
  memory/projects.json
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

Implemented: init, MCP import/launcher/sync/doctor, restore/reset, local UI, skills add/list/remove/import/delivery, shared rules/index delivery, init-repo templates and scoped memory record management through CLI/UI/MCP. Explicit content mutations default to preview and require the reviewed revision. Project automation is enabled through a reviewed setup; subsequent native imports/checkpoints use that policy, the same transaction service and recovery. Plain sync retains MCP-only behavior; `--area skills` and `--area context` select the other projections.

Next is the maintainer's real working trial in [WORKING_GUIDE.md](WORKING_GUIDE.md), including model-driven retrieval and a two-client memory handoff, followed by remote macOS/Linux CI, package install checks and release identity. Structured interchange with an external graph memory server remains separate future work. The separate English landing page uses locale files for translation PRs; hosting is maintainer-managed and deferred.

## Memory MVP

CLI/UI/MCP share the implemented record service. See [MEMORY.md](MEMORY.md) for exact commands and limits. External graph interchange described below is planned, not implemented.

### Initial architecture decision

Use Hub-managed Markdown as the only authoritative store for the MVP. Expose a small built-in MCP adapter over the same service used by CLI and UI. Reuse the existing managed-plan, Hub lock and artifact recovery mechanisms; verify their behavior with memory record/index updates before claiming equivalent guarantees. Do not introduce a generic backend framework while only one backend is implemented.

The external `@modelcontextprotocol/server-memory` is a planned optional import/export integration, not a runtime dependency or a second live store for Hub records. Its future import must retain source attribution and leave the source untouched. A stable source identity must make repeated import detectable; changed records require an explicit conflict decision. Preserve entities and relationships in the interchange representation or report unsupported data before import; never silently flatten away relationships. Export must create a separate snapshot without overwriting a graph being served by another process. Current import handles only explicitly selected local UTF-8 text as one record body.

Do not run automatic bidirectional synchronization or give agents two writable copies of the same collection. An external graph backend can be reconsidered after an actual use case requires graph traversal; it would replace the authoritative store for its collection rather than mirror it. The initial built-in MCP API is not a claim of drop-in compatibility with the external server's graph tools.

### Purpose and boundaries

Memory preserves useful knowledge across sessions and clients. Each record describes one independently maintainable fact, preference, decision or lesson. Instructions remain in instruction files; skills describe procedures; PROJECT.md describes the repository; NOW.md describes current work. Conversation transcripts are sources that may be reviewed, not memory records by default. References to repository documents should replace duplicated facts when practical.

There are two initial scopes:

- Shared: knowledge deliberately made available across projects in the selected Hub. Adding or promoting a record to this scope must be explicit.
- Project: knowledge associated with one registered project. Agents working on that project may use its records and explicitly enabled shared memory. Other project collections are excluded from normal reads, search results and startup indexes.

Canonical records stay in the local Hub by default. This avoids publishing private project notes merely because a repository is public. Exporting selected knowledge into a repository is a separate explicit action. A selected Hub defines the initial sharing boundary; work/personal profiles and access controls are not implemented by adding a scope label.

### Storage and identity

Use UTF-8 Markdown with validated YAML metadata and one record per file. Initial metadata covers a stable ID, title, scope/project ID, creation/update timestamps, optional tags and a source reference. The body holds the knowledge and necessary context. An operation revision is calculated from actual stored bytes, so direct editor changes invalidate old plans.

Keep existing hand-written memory documents readable. Adopting them into structured records requires an import preview; it must not silently rewrite MEMORY.md or interpret every Markdown file as a managed record. Generated indexes need explicit ownership and preserve unrelated text.

The project registry assigns a stable local ID with explicit checkout bindings. Do not derive identity solely from a folder name or remote URL. Worktrees may share an explicitly registered project; another clone is not silently attached, and a moved or unknown checkout requires rebinding. Do not return other project names or matching snippets when a caller lacks the corresponding configured scope.

Markdown is the source of truth. MEMORY.md is a compact derived index rather than a second database. Initial search uses scoped text and metadata matching. Embeddings, graph storage and a persistent search index can be added later if measured use warrants them; a derived index must always be rebuildable from records.

### One service, three interfaces

CLI, local UI and an optional built-in stdio MCP server call the same memory service. That service owns validation, scope resolution, search, mutation planning, revision checks and recovery. The MCP adapter must not introduce another storage format or bypass the shared Hub lock.

Implement list/get/search first, then create/update/delete and reviewed import. Writes use preview/apply with checked revisions and recoverable originals, including dependent index updates. Concurrent writers must re-read under the operation lock; a stale revision fails rather than overwriting a newer fact. Malformed metadata and ambiguous imports are reported with their source and are never silently repaired or merged. Tests must cover direct editor changes and multiple CLI/MCP processes.

The MCP process starts with an explicitly configured workspace and allowed scopes. Client-supplied project IDs or filesystem paths do not expand that boundary. Read operations are available by default; enabling reviewed write tools is a separate configuration choice. Automatic checkpoints additionally require `--allow-auto`, an enabled project policy and an active one-use lifecycle token. This is a boundary for Hub-mediated operations, not a sandbox against an agent with independent filesystem access.

Startup context contains a small relevant index and usage guidance, not all facts from all projects. Facts are retrieved on demand through files or MCP. Connecting MCP does not make an agent automatically remember: delivered instructions explain when to search and when to propose saving knowledge, and real client behavior must be verified.

### Delivery order and acceptance

1. Implement record validation, project bindings, scoped reads/search and CLI operations.
2. Implement reviewed writes/import, index maintenance, revision conflicts and recovery tests.
3. Expose the same service through optional stdio MCP and local UI; test MCP through real protocol calls. This is covered by isolated independent stdio-client tests.
4. Verify model-driven use in actual clients: save a project fact, retrieve it from another client, update it safely, reject a stale write, and exclude an unrelated project's fact. This remains part of the personal working trial; protocol fixture tests do not prove a model follows the workflow.

Native client auto-memory is preserved. [Automatic memory](AUTOMATION.md) copies notes from explicitly configured native Markdown directories and requests evidenced semantic checkpoints from the active agent's context. Source bindings detect duplicates and local edits; conflicts are queued privately. A foreground watcher can synchronize native changes outside active sessions. This does not relocate native storage, promote facts across projects or bulk-ingest archived transcripts. Hook delivery preserves unrelated settings and uses normal guarded setup/backups; native trust and permissions remain client-owned.

Reference implementations: the [MCP memory server](https://github.com/modelcontextprotocol/servers/tree/main/src/memory) models entities, relations and observations; the [MCP tools specification](https://modelcontextprotocol.io/specification/2025-11-25/server/tools) defines the interface used by the proposed adapter. These are architectural references, not dependencies or claims of implemented compatibility.

## Later milestones

- MCP registry add/remove commands; these are still explicit stubs.
- Profiles/tags for work and personal scopes.
- OS credential stores instead of .env.
- Session indexing/search and history-assisted handoff.
- OS-managed background services and bulk archived-session extraction.
- Additional client adapters and independent distribution of public skills/templates.

Repository setup seeds normal files; it does not run agents, continuously update NOW.md or guarantee a model follows instructions. Windows end-to-end behavior, large-tree performance, network filesystems, ACLs/xattrs and abrupt machine-loss recovery remain separate verification work.
