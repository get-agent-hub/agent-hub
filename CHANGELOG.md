# Changelog

## Unreleased

- Rebuild the local interface around Overview, All data and Projects. Add light/dark themes, a responsive layout and quieter resource/conversation views. Move setup and diagnostics to Sources & settings while retaining reviewed writes, full-event access and old bookmarks. Split browser code into bounded slices with enforced dependency rules.

- Correct item-level MCP delivery from the interface by passing its validated preview revision to the existing replacement guard. Unreviewed, expired and externally changed plans remain blocked.
- Read DSH nested message envelopes as conversations, collapse tool/reasoning details and separate technical context with an All events view. Correct old archived projections and fallback titles at read time without reimport.
- Preserve supported Claude, Codex and DSH conversations in a private, versioned local archive with complete-event search, project associations, attachment coverage and scoped read-only MCP connections. Add automatic metadata discovery, the Chats page, reviewed access/deletion policies and optional foreground refresh.
- Organize backend modules by subsystem, split HTTP routing and sync/setup operations, and enforce dependency boundaries, runtime-cycle checks and module-size limits. Clean builds remove stale compiled modules; existing CLI and HTTP behavior is retained.

- Find projects from selected local Claude Code chat metadata in the UI, including ordinary folders, missing locations and grouped Git worktrees. Discovery is read-only and reports incomplete coverage; it does not archive chats or connect project memory.
- Continue project discovery in cancellable batches with progress, paginated search, safe folder reveal and visibly retained previous results. Handle large initial records and isolate unrelated client/Git errors. Supported capacity limits stay explicit.
- Record implementation policies and 47 acceptance cases for simpler setup, synchronization, archive access and recovery, with explicit ownership by implementation slice.

## 0.1.0-beta.1 — 2026-11-04

First public beta. Distributed on GitHub as a source ZIP and a standalone npm tarball; no public npm registry package is published.

- Set up one shared Hub for Claude Code, Codex CLI and DeepSeek Harness with `ahub quick`, or use the local UI. Connect a Git project's memory and handoff separately.
- Collect and deliver MCP definitions, complete skill bundles and shared instructions with reviewed plans, conflict detection and preservation of unrelated client settings.
- Share scoped Markdown knowledge through CLI, UI and the built-in memory MCP. Import matched native Markdown memory and enable project-gated lifecycle checkpoints or a foreground watcher.
- Inspect configuration drift, MCP discovery and separate service-readiness evidence. Configuration does not prove native activation or useful learning.
- Recover with guarded workflow undo, per-stage restore and first-baseline reset. Later external edits block recovery rather than being silently overwritten.
- Keep six everyday command groups in default help, with a complete advanced caller/purpose reference. Terminal setup asks for confirmation after its preview; scripts and JSON preview without writing.
- Install a standalone globally callable `ahub` / `agent-hub` with locked production dependencies and an isolated installer cache.
- Read the separate English/Russian landing and documentation with stable page and section switching.

### Beta limitations

macOS/Linux are supported targets; Windows is experimental. Native activation and model-selected memory usefulness require a real-client trial. Multi-stage workflows and multi-file recovery are not power-loss-safe transactions. Graph-memory interchange, native SQLite import, archived-session indexing and OS-managed background services are not implemented. See [release preparation](docs/RELEASE.md), [recovery](docs/RECOVERY.md) and [verification history](docs/QA.md).
