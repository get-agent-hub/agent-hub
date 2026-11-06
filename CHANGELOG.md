# Changelog

## Unreleased

- Acquire the Hub lock before reading and planning automatic memory checkpoints and native-note imports. Concurrent clients no longer mistake a managed writer's temporary staging files for foreign records. Keep strict unexpected-file checks, reviewed manual writes and bounded contention retries.

## 0.1.0-beta.4 — 2026-11-06

Find an earlier conversation and carry reviewed context to another client. This prerelease includes the local Claude Code, Codex and DSH archive, full-event search, readable chat titles/dates, project grouping, optional background updates and context packets for new conversations. The simpler interface also covers shared MCP, skills, instructions and scoped memory with reviewed changes and recovery. Beta.3 was not published because its release checks exposed a background updater race.

Basic usage analytics is **on by default**. Disable it in Sources & settings, with `ahub telemetry off`, or with `DO_NOT_TRACK=1`. Events contain named actions, a random installation ID, language and version; chat text, search queries, paths, client configuration and credentials are excluded. Website analytics has a separate setting and identity. No session replay or third-party browser SDK is loaded in the local Hub.

- Read background control metadata without a second filesystem lookup after reading its contents. A worker stopping between those operations no longer makes status or stop fail with a missing-file error.
- Add deterministic disappearing-lease and corrupt/symlink metadata regressions. Wait for a completed source receipt when testing replacement-source detection, rather than observing the start of a scan.

The maintainer confirmed the real Codex → DSH and PostHog checks on the beta.3 feature basis. Beta.4 adds the automated race regressions; a separate manual beta.4 trial is not claimed. Install from the attached source ZIP or npm tarball; Node.js 22.13+ and npm are required, and installation can download dependencies. Public npm registry publication is deferred. macOS and Linux are supported; Windows is experimental.

Unavailable attachments and unsupported coverage are reported explicitly. Shared settings use reviewed delivery; context packets do not transfer active native sessions. Multi-file recovery is compensating rather than power-loss-safe. Actual OS sign-in activation remains an unverified manual check. Earlier candidate tags are kept unchanged.

## 0.1.0-beta.3 — 2026-11-06

Unpublished candidate: release CI exposed a background metadata read race. Superseded by beta.4; its tag remains unchanged.

Find an earlier conversation and carry inspected context to another client. This prerelease includes the archive/interface work from the unpublished beta.2 candidate, plus basic usage analytics.

Basic usage analytics is **on by default**. Turn it off in Sources & settings, run `ahub telemetry off`, or set `DO_NOT_TRACK=1` before using Hub. Events contain named actions, a random installation ID, language and version; chat text, search queries, project paths, client configuration and credentials are excluded. Website analytics has a separate setting and identity. No session replay or third-party browser SDK is loaded in the local Hub.

- Preserve supported Claude Code, Codex and DeepSeek Harness histories in a local, versioned archive with complete-event search, project associations and explicit attachment/coverage limits.
- Read conversations with useful titles and native dates, newest-first sorting, expandable tool/runtime details and preserved source versions.
- Prepare bounded, version-pinned context packets for a new conversation in another client; copy/download rechecks access. No separate model call or native runtime transfer is performed.
- Keep selected archive sources updated after closing the UI, with optional reviewed user-login startup. Native history stays in place; configuration presence does not prove activation.
- Use the simpler Overview, All data and Projects interface, responsive layouts and light/dark themes. Keep technical details in disclosures.
- Resolve MCP differences per server and client, recognize existing connections to the same Hub and preserve unrelated settings and local tool policies.
- Send basic usage outcomes asynchronously through a first-party relay. Honor opt-out, DNT/GPC and environment overrides; background capture, polling, previews and failed operations do not count as activity. No retry queue or backfill.
- Install a standalone globally callable `ahub` / `agent-hub` with locked dependencies. Fix the isolated timeout test on the supported Node 22 runtime.

### Beta.3 verification and limits

The preceding runtime baseline passed Linux/macOS and Node 22.13/24 checks with 345 tests; the beta.3 tagged workflow then exposed the race fixed in beta.4. Local checks also covered isolated package installation/reinstallation/removal, and secret/history scans. The maintainer confirmed the real Codex → DSH scenario, including external-edit conflict and recovery, and observed PostHog events on 2026-11-06. These are maintainer-reported manual results, separate from automated fixtures.

Unavailable local attachments and unsupported source coverage are reported explicitly. Shared settings use reviewed delivery, not universal automatic bidirectional reconciliation. Context packets are reference data, not active-session migration. Multi-file recovery is compensating, not power-loss-safe. Actual OS sign-in activation remains a separate unverified manual check. Windows is experimental; public npm registry publication is deferred. Download the source ZIP or installable tarball from GitHub Releases; Node.js 22.13+ and npm are required, and installation can download dependencies.

## 0.1.0-beta.2 — 2026-11-06

Unpublished candidate, superseded by beta.3. Its existing tag and draft remain unchanged.

Local conversation archive and a simpler interface. Distributed as reviewed GitHub source/package archives; no public npm registry installation.

- Make archive status and source settings easier to read: visible storage/update summary, client cards, grouped update switches and expandable folder/read details. Explain attachment-reference coverage separately, omit zero warnings and move index rebuilding into troubleshooting.

- Prepare reviewed, version-pinned context packets for a new conversation in Claude Code, Codex or DSH. Include bounded original-message excerpts, an optional next step and source references; copy/download rechecks access. No separate model call or native session transfer.
- Add reviewed user-login startup for the saved archive selection on macOS launchd/Linux systemd. Preserve edited or foreign startup files, support recovery and check the enabled Hub binding before resuming. Changes apply at the next user-session start; current jobs are not reloaded.

- Keep selected native chat sources updated in one optional detached worker after closing the browser, terminal or Hub UI server. Persist the source selection, retry temporary failures, show last complete reads and stop cooperatively without deleting archives. Add `history watch --background` / `--stop`; Login startup is a separately reviewed option.

- Reuse bounded in-memory chat title/date summaries while checking current access and saved index identity. Load Overview history only when that page is shown, avoiding duplicate archive reads on Chats. Add real interface screenshots with fictional data to the README.

- Derive readable Codex/DSH titles instead of environment blocks (including nested AGENTS wrappers), approval boilerplate and 20-character fallback excerpts. Preserve native/provider titles and delegated-task labels, label review/build-output sessions and keep all original events accessible.

- Default chat lists and Overview conversations to newest native dates first. Add an oldest-first selector, sort before pagination and keep unknown dates last without changing archived data.

- Show native conversation date/time in chat rows and the open conversation, in the browser’s local timezone. Existing archives work without reimport; missing timestamps are not replaced with capture dates.

- Recognize existing connections to the same Hub across Node versions and package locations. Keep working launchers instead of reporting false MCP conflicts or migrating their paths. Do not offer launchers as original import sources; other Hub targets and launch overrides still require review.

- Make MCP setup a per-server choice: explain differing settings, show both Hub/client directions and review client connections separately. Keep configuration JSON, batch operations and connection probes in disclosures. Compare credentials privately without returning their values.

- Show one recorded root per project, with related folders in details and separate groups for ordinary or unavailable historical locations. Retain all associations, identities and client grants.

- Use substantive chat titles instead of Claude terminal notices, greeting-only excerpts and pasted-content wrapper tags, including in existing archives without reimport. Keep list rows readable and archive metadata in conversation details.

- Rebuild the local interface around Overview, All data and Projects. Add light/dark themes, a responsive layout and quieter resource/conversation views. Move setup and diagnostics to Sources & settings while retaining reviewed writes, full-event access and old bookmarks. Split browser code into bounded slices with enforced dependency rules.

- Correct item-level MCP delivery from the interface by passing its validated preview revision to the existing replacement guard. Unreviewed, expired and externally changed plans remain blocked.
- Read DSH nested message envelopes as conversations, collapse tool/reasoning details and separate technical context with an All events view. Correct old archived projections and fallback titles at read time without reimport.
- Preserve supported Claude, Codex and DSH conversations in a private, versioned local archive with complete-event search, project associations, attachment coverage and scoped read-only MCP connections. Add automatic metadata discovery, the Chats page, reviewed access/deletion policies and optional foreground refresh.
- Organize backend modules by subsystem, split HTTP routing and sync/setup operations, and enforce dependency boundaries, runtime-cycle checks and module-size limits. Clean builds remove stale compiled modules; existing CLI and HTTP behavior is retained.

- Find projects from selected local Claude Code chat metadata in the UI, including ordinary folders, missing locations and grouped Git worktrees. Discovery is read-only and reports incomplete coverage; it does not archive chats or connect project memory.
- Continue project discovery in cancellable batches with progress, paginated search, safe folder reveal and visibly retained previous results. Handle large initial records and isolate unrelated client/Git errors. Supported capacity limits stay explicit.
- Record implementation policies and 47 acceptance cases for simpler setup, synchronization, archive access and recovery, with explicit ownership by implementation slice.

### Beta.2 limits

Local supported source files only; unavailable attachments and incomplete coverage are reported. Context handoff prepares bounded original excerpts for a new conversation, not native runtime migration. Shared settings still use reviewed operations rather than universal automatic bidirectional sync. Multi-file recovery remains compensating, not power-loss-safe. Actual client usefulness and OS sign-in activation are separate manual checks. Windows remains experimental; public npm registry publication is deferred.

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
