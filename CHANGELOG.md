# Changelog

## Unreleased

- Organize backend modules by subsystem, split HTTP routing and sync/setup operations, and enforce dependency boundaries, runtime-cycle checks and module-size limits. Clean builds remove stale compiled modules; existing CLI and HTTP behavior is retained.

- Find projects from selected local Claude Code chat metadata in the UI, including ordinary folders, missing locations and grouped Git worktrees. Discovery is read-only and reports incomplete coverage; it does not archive chats or connect project memory. Codex and DSH readers remain planned.
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
