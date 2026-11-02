# Verification — 2026-11-02

The implemented import → sync → doctor → restore flow was exercised through the live UI and production CLI on macOS. Client writes used temporary configurations. Production client configurations were not synchronized.

## Automated checks

All **43 tests passed**, and JavaScript syntax and `git diff --check` passed.

`npm test` builds the CLI and runs the import, UI API, sync/restore and doctor suites. The suite covers credential redaction, source preference, reviewed-variant replacement, subsequent local-edit conflicts, stale previews, client scope, Codex policies, atomic rollback, symlinks, CLI defaults, HTTP request protection, protocol pagination, process cleanup and cancellation.

## Live UI fixture

Run `npm run qa:ui` and open http://127.0.0.1:3083. The server creates an independent hub, three temporary client configurations and a repository with project context. The fixture is retained after shutdown.

Verified manually through the browser:

- Import preview writes nothing and hides credentials; selecting Codex as the preferred source resolves a conflicting definition.
- Import adds four hub servers without changing client files.
- Sync dry run shows three files; an external file change invalidates the preview and blocks apply.
- A fresh preview applies all three files with a backup. Status changes to matching, and another dry run reports no changes.
- JSON settings, TOML/YAML comments, Codex tool approval policy and DSH UI preferences survive the write. Client definitions use the hub launcher and contain no fixture API token.
- Doctor discovers three tools on healthy servers, accepts zero tools, reports a tools/list timeout and cancels a running probe. The fixture method log contains initialization and tool discovery only.
- Skill source selection, escaped Markdown containing a script tag, search shortcut, no-results state, instructions, both memory documents, repository document switching and the planned Sessions state work. The desktop layout was visually inspected.
- The shared restore engine restores all three files byte for byte, including an external comment that existed at backup time.

The fixture injects client paths into shared services. Its copied apply/restore commands cannot reproduce that injected context through production CLI defaults; revision/target guards reject that mismatch. Exact copied-command execution was checked separately below.

## Production CLI with isolated DSH

An independent temporary hub and `DSH_HOME`, including a path with an apostrophe and spaces, passed:

1. Init, import dry run and import apply.
2. Sync dry run and execution of its exact emitted apply command.
3. Matching status, doctor with three tools and idempotent second sync.
4. Restore dry run and execution of its exact emitted restore command.
5. Byte-for-byte restoration and unchanged hashes of actual Claude, Codex and DSH configuration files.

## Fixes found by this pass

Choosing an import source previously left sync unable to replace the other reviewed variants. Import now records private hashes that authorize replacing those exact variants; later local edits still block sync. A regression test covers both cases.

Cancelled doctor rows previously fell back to success text. They now state that the check was cancelled, and the overview includes cancellation counts. The corrected result was verified in the live UI.

## Real MCP discovery and limits

A prior live run against the user's hub found ten servers passing initialization/tool discovery, one `n8n-mcp` process exiting during initialization, and application-managed `node_repl` skipped. A stale Claude skill directory lacking `SKILL.md` also needs attention. These are environment findings, not passing checks.

Doctor does not execute tools or validate every provider API operation. Windows descendant cleanup, mobile/responsive layout and real client restart/loading after production sync were not verified. Instruction/memory delivery, repository initialization and session indexing remain unimplemented.

## n8n follow-up

The original initialization failure was reproduced and traced to npm `ENOTEMPTY` while renaming an incomplete cached `n8n-mcp` package. The affected cache entry was moved intact to `.tmp/n8n-npx-cache-backup-20261102` before npm restored it. MCP initialization and discovery then passed with **28 tools**. No client configuration or cluster deployment was changed.

An independent readiness check found **DNS ENOTFOUND** for the configured n8n endpoint. The MCP remains healthy; backend availability is a separate warning. This confirms DNS unavailability, not the cluster's intended deployment state.

Five additional tests cover package-cache vs HTTP-service errors, healthy MCP with HTTP 503 backend and recovery, credential-free requests, query/fragment removal, redirect/protected/hidden endpoints, cancellation/deadlines and safe DNS/TLS/refused-connection diagnostics.
