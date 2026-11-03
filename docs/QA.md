# Verification snapshots

The implemented import → sync → doctor → restore flow was exercised through the live UI and production CLI on macOS. Client writes used temporary configurations. Production client configurations were not synchronized.

## Earlier MCP snapshot — 2026-11-02

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

Doctor does not execute tools or validate every provider API operation. Windows descendant cleanup, mobile/responsive layout and real client restart/loading after production sync were not verified. At that snapshot instruction/memory delivery, repository initialization and session indexing were unimplemented; the content milestone below supersedes the first two limitations.

## n8n follow-up

The original initialization failure was reproduced and traced to npm `ENOTEMPTY` while renaming an incomplete cached `n8n-mcp` package. The affected cache entry was moved intact to `.tmp/n8n-npx-cache-backup-20261102` before npm restored it. MCP initialization and discovery then passed with **28 tools**. No client configuration or cluster deployment was changed.

An independent readiness check found **DNS ENOTFOUND** for the configured n8n endpoint. The MCP remains healthy; backend availability is a separate warning. This confirms DNS unavailability, not the cluster's intended deployment state.

Five additional tests cover package-cache vs HTTP-service errors, healthy MCP with HTTP 503 backend and recovery, credential-free requests, query/fragment removal, redirect/protected/hidden endpoints, cancellation/deadlines and safe DNS/TLS/refused-connection diagnostics.

## Content milestone — 2026-11-03

The live UI fixture now injects content targets as well as MCP configs. Browser checks exercised:

- Import of a client-only skill into Hub with a content backup.
- Delivery of skills to three temporary clients, including replacing an identical directory with a canonical link; a second preview reported zero changes.
- Delivery of common rules and MEMORY.md to all three temporary clients; Claude received imports and Codex/DSH received the index. Repeating through the Memory page reported zero changes.
- Prepare repository appended the workflow, created the Claude import and preserved PROJECT.md/NOW.md. A second preview reported zero changes.
- The content dialog was visually checked at a narrow viewport, with a horizontally scrollable table and a disabled Apply button for a no-op plan.

These writes affected only the retained temporary fixture. Real model behavior after restarting an actual client remains part of [WORKING_GUIDE.md](WORKING_GUIDE.md), not something the UI fixture proves.

Additional regressions cover complete skill assets and executable modes, existing linked originals, shared roots, shadowed local copies, reserved Claude namespaces, Codex metadata, source changes, first-touch artifact recovery, corrupt originals, changed bindings, failed reset installation, context ownership and repository templates. Production CLI commands are exercised in isolated real client directory layouts, including exact copied apply/restore commands.

### Final validation

The final quality gate passed with **113 tests**, ESLint, Prettier and strict TypeScript checks. All 113 tests also passed on Node **22.13.0**. Coverage on that minimum runtime was **89.74% lines**, **84.05% branches** and **87.41% functions**, above the configured thresholds.

Read-only plans against the actual configured Hub/client locations identified equivalent-link migrations without executing them. Hashes and physical bindings of ten monitored configuration files remained unchanged. Personal plan output is local and excluded from Git. Native client discovery and cross-agent use are still the next maintainer working run.

## Scoped memory milestone

The memory milestone adds 17 isolated tests, bringing the suite to **130 passing tests**. `npm run check` passes Prettier, ESLint, strict TypeScript and the complete suite. All 130 tests also pass on the minimum Node **22.13.0** runtime with coverage of **90.76% lines**, **83.64% branches** and **87.77% functions**. Package validation includes the memory CLI/core/MCP modules, UI asset and user guide: **162 files**, **806728 bytes unpacked**, with local state, fixtures and research excluded.

The new tests cover project/shared isolation, explicit checkout binding and rebinding after repository replacement, source-preserving selected-text import, record validation, symlink rejection, byte-preserving personal index text, owned-block protection, stale revisions, concurrent collection changes, restore and reset archives. Two independent MCP stdio processes exchange a fact and update it; stale mutations fail. A simultaneous competing-write test preserves both facts after the rejected writer reviews a fresh plan. Read-only servers neither expose nor execute write tools, and shared reads require separate configuration.

HTTP checks exercise the same memory service through a fixed UI workspace, including session tokens, rejection of caller-supplied workspace fields, private single-use previews and a body larger than the ordinary API request limit. Browser interaction in Safari against temporary fixture data verified creating, reading, updating and deleting a project record with backup output. Editing a form field invalidated its old preview and disabled Apply; a title containing a script tag remained literal text. The QA tab and fixture server were closed after verification. This run did not establish a new responsive-layout baseline.

No real client configuration or native auto-memory was migrated for these tests. Actual model-driven retrieval/saving across installed clients remains the personal working trial in [WORKING_GUIDE.md](WORKING_GUIDE.md). The external graph memory server's structured import/export is not implemented; current import handles deliberately selected local text.

## Automatic memory milestone

Project-scoped automation adds 19 tests for **149 passing tests** in total. The final quality gate passes Prettier, ESLint, strict TypeScript and the complete suite. All 149 tests also pass on Node **22.13.0**, with coverage of **91.59% lines**, **83.63% branches** and **88.53% functions**. Package validation passes with **179 files**, **928326 bytes unpacked**; the automation guide and compiled callback/MCP modules are included, while local state, fixtures and research remain excluded.

Isolated scenarios cover one-time policy setup, preservation of unrelated hooks/settings, setup idempotence across clients, ownership conflicts, DSH insert-patch generation, native note/section import, content deduplication, stable source identity after a title edit, source updates, restore, manual-edit conflicts and explicit resolution. Deleted notes preserve learned records, and deleted Hub records are not silently resurrected. Malformed notes, symlinks, overlapping directories, stale source previews and credential-like content are handled without overwriting the sources or retaining detected credentials.

Lifecycle tests exercise the semantic checkpoint request/submit protocol, not a simulated language-model judgment. They cover the DSH bridge's always-false stop flag, continuation-prompt loop prevention, empty checkpoints, fact/index/source-binding rollback, expiry and bounded cleanup of expired session capability metadata. Tokens cannot cross clients, sessions or projects, and disabling a policy prevents capture. A conversation that started from an older memory revision queues a conflicting replacement instead of overwriting another agent's newer knowledge.

Real independent MCP stdio processes expose the automatic tool only with its separate flag and save through the project policy. Concurrent automatic writers retain both independent new facts through bounded contention retries. CLI tests replay an exact setup plan, import the selected native note, report status, consume hook JSON stdin without copying the prompt, and stop the foreground watcher cleanly with SIGTERM. The UI's fixed-workspace automation status endpoint is checked through HTTP; no new browser layout baseline was established for its additional status text.

Real user client configurations were not changed by these fixture runs. Actual native hook activation, client trust/permissions and model-driven quality remain the working trial in [AUTOMATION.md](AUTOMATION.md). Automation extracts from an active conversation and selected native Markdown sources; it does not bulk-ingest archived sessions or mount an external graph-memory backend.

## Consistency and native DSH audit

The audit found and corrected destructive whitespace deduplication, Markdown heading splitting inside fenced examples, missing provenance for duplicate sources, restored checkpoint-token replay, and session routing after a working-directory change. Duplicate sources now retain read-only links to one canonical record. Divergence queues a visible conflict and repeat synchronization does not recreate an obsolete duplicate. Manual edits and explicit deletions survive; native sources remain unchanged.

Conflicts from both native notes and semantic checkpoints can be inspected and resolved through guarded CLI plans. The Memory UI displays both versions and previews keeping Hub or accepting the queued incoming version. Changed queue/record inputs reject the reviewed preview, and accepted previews are single-use. Incoming conflict history remains accessible after resolution. Status reports missing/malformed/credential-like native sources without copying their contents. Restore/reset invalidate old checkpoint capabilities through recovery authority stored outside the restorable Hub.

The optional DSH Claude hook bridge was absent from the installed runtime. Setup now delivers the bundled native Cordis adapter instead. `scripts/check-dsh.mjs` passed against installed DSH **0.2.1-rc.5**, exercising its actual event dispatcher and Session message validation, one checkpoint continuation, a saved fact and scoped reads. Additional regressions distinguish a user fork from a delegated subagent and reject cross-project cwd drift. These checks use fixture agents and do not call a provider or prove model compliance in a live conversation.

The complete quality gate passes **159 tests**, Prettier, ESLint and strict TypeScript. All **159** also pass on minimum Node **22.13.0**, with **91.44% lines**, **83.23% branches** and **88.34% functions**. An earlier coverage run overlapped package compilation and failed one launcher check; the final run used stable build output and passed. Package validation passes with **187 files**, excluding local state and research. `scripts/check-install.mjs` passed a real tarball installation, CLI preview/apply, scoped reads and installed adapter/UI paths. The initial offline attempt correctly failed because a dependency was uncached; after a registry-backed dependency install, the offline smoke passed.

No production client settings or native notes were modified. The landing repository remains unchanged. Remaining validation is the personal working trial: activate the reviewed hooks/profile, exercise a real task in each client and verify the usefulness of model-selected facts. This pass does not claim graph-server synchronization, archived-session ingestion, global filesystem atomicity or protection against an independent writer changing a file between the final check and replacement.

## Existing-memory onboarding

Memory discovery and reviewed onboarding add 11 regression scenarios, for **170 passing tests** on Node 25 and minimum Node **22.13.0**. The complete Prettier/ESLint/strict TypeScript quality gate passes. Minimum-runtime coverage is **91.39% lines**, **83.10% branches** and **88.64% functions**.

Discovery returns source identities, paths, format and project evidence without note bodies or conversation text. Tests cover bounded cwd metadata, unresolved and conflicting evidence, explicit project assignment, symlinked-directory ambiguity, known foreign projects, unsupported SQLite stores and intentionally shared checkout bindings. A read-only inventory of actual installed client locations was also exercised without applying imports or changing client settings.

Onboarding tests prove a write-free preview, preservation of native originals, idempotent repeat imports, source freshness checks and one-transaction recovery of facts/index/bindings plus the optional follow-up policy. Mixed MEMORY.md documents retain inline knowledge and fenced examples while pure visible local navigation is omitted informationally. Existing native import and cross-client consistency regressions still pass.

CLI tests execute the exact printed onboarding command. HTTP tests bind discovery/import to the UI workspace, require the session token for previews, reject injected workspace fields and consume the reviewed preview once. The UI exposes source selection and an optional follow-up policy; no new browser layout baseline is claimed. The actual tarball passes a clean offline installation with discovery/onboarding and inline MEMORY.md import, followed by DSH adapter setup. Installed DSH 0.2.1-rc.5 compatibility still passes.

Native SQLite and external graph data are reported/unsupported rather than imported through an assumed schema. No archived conversation was copied. Hook installation remains a separate reviewed action; following sources enables the project policy and may activate handlers already installed for that client.

## Personal-trial preparation and restrictive umask

Preparing independent client originals exposed a real macOS edge case: nested symlinks created under umask 077 received different link modes, so a directory copy failed fingerprint verification. Directory copying now preserves those recorded nested-link modes without following or chmodding targets. Existing snapshot fingerprints are unchanged. A regression verifies the copied tree, unchanged source, target contents/permissions and link binding under a restrictive umask.

The complete quality gate passes **171 tests** on Node 25. All **171** also pass on Node **22.13.0**, with **91.45% lines**, **83.10% branches** and **88.64% functions**. A separate disposable trial-kit exercise passed preparation, A/B project registration, existing-note import, delivery to three synthetic client configs, reset with an archive, exact original-path verification and preparation of a fresh independent repeat. No real client delivery/reset was applied by that exercise.

A private personal Hub and independent originals were prepared outside the source checkout. Read-only delivery previews and a monitored-path comparison confirmed the actual client configs/skills and original Hub inputs were unchanged. Real model-driven acceptance remains the user's working trial. Reset covers recorded managed state; it does not erase conversations, independently written native notes, client-native trust approvals or external API effects.

## Quick setup validation (2026-11-04)

Quick is covered by an isolated CLI flow using temporary Claude, Codex and DSH profiles. The tests verify a read-only first preview, MCP and complete-skill collection/delivery, Git project binding, matched Markdown memory, project-gated hook setup, unchanged repeat runs, stale-plan rejection and full reset of recorded originals. They also cover ambiguous sources, a failed hook stage with independent successful delivery, disabled clients sharing a skill root, both first-touch orders for DSH hooks/MCP, individual content restore and protection of later external edits.

The HTTP checks verify token enforcement, startup-workspace binding, input validation and single-use quick previews. Browser QA exercised the wizard, its conflict preview and the per-stage partial result using temporary profiles only. No production client settings were changed by these checks.

The main suite contains 180 tests. Minimum-runtime verification uses Node 22.13 with the coverage thresholds enforced by the test runner. The separate site has 15 English documentation pages and checks locale-owned bodies, protected code syntax, navigation, anchors, source archive provenance and local HTTP behavior.

A successful setup test is not evidence of useful model-selected memory or activation in every client version. Real-client restart, native trust/permissions, a two-client working task and a review of captured facts remain the maintainer's working trial. Quick does not create an OS service, install a standalone Memory MCP server, import native SQLite or provide a workflow-wide transaction.

## Global CLI installation

`npm run install:check` installs the built local folder using npm's global mode with a disposable prefix and isolated client/Hub paths. From a directory outside the source checkout, it verifies both executable names, quick preview/apply, status and the live UI's static assets. The check does not modify the user's normal global prefix or client settings. It is included in the macOS/Linux CI matrix. End-user documentation now starts with `npm ci`, `npm run build`, `npm install --global .`, then uses `ahub` directly.
