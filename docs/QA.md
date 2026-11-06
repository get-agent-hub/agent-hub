# Verification snapshots

The implemented import → sync → doctor → restore flow was exercised through the live UI and production CLI on macOS. Client writes used temporary configurations. Production client configurations were not synchronized.

## Login startup and cross-client context packets — 2026-11-06

`npm run check` passes **339 tests**. Standalone coverage also passes **339 tests**, with **93.49% lines**, **85.68% branches** and **91.90% functions**. The **13-test** startup/handoff/HTTP suite passes on minimum Node **22.13**. Architecture checks pass **196 modules / 957 imports**. Package validation and the actual temporary-prefix installer pass, including the installed handoff CLI and both new browser modules.

Startup tests install/remove only files under injected temporary homes. They verify macOS plist arguments with the actual `plutil` parser, systemd user file/link contents, escaped substitutions/quotes, no-write preview, exact revision apply, idempotent repeat, stale-policy rejection, edited/foreign file preservation, invalid ownership, symlink boundaries and managed recovery. The login entry point runs directly against a temporary Hub: it captures the saved selection, picks up another message and exits cooperatively after a stop. Stopped, malformed or mismatched controls do not resume it. This proves file/entry-point contracts, not an actual logout/login, launchd registration or Linux user-manager integration trial. Setup intentionally does not reload current user managers or supervise crashes.

Context tests verify preserved-version reads after native changes/removal, exact original excerpts and references, omitted runtime/tool content, large boundary records, explicit omission notes, grants/exclusions/revocation, corrupt-block rejection, strict HTTP inputs and read-only CLI output from an unrelated directory. Startup apply previews are authenticated, expiring and single-use. No target-client configuration or archive grants are added by preparing context. A read-only existing-archive check prepared **11 excerpts / 10,748 characters** and verified that the archive catalog digest stayed unchanged; no real message text or private paths were printed or saved in the report.

A separate headless browser fixture passes source selection, background refresh, startup preview cancellation, apply, reload and removal; saved-version context, target/next-step changes, clipboard action, actual Markdown download, fresh access checks after source exclusion and dialog cleanup on navigation. Desktop and 400px screenshots were inspected after making the preview show readable messages with source links and keeping the full packet collapsed. No overflow/runtime exceptions or native config edits were observed. Startup paths stayed inside the temporary fixture. No real startup installation, new native client session or model request was performed. The receiving agent's usefulness and actual post-login behavior remain user trials.

## Selected-source background archive updates — 2026-11-06

`npm run check` and standalone coverage pass **326 tests**; coverage is **93.59% lines**, **85.62% branches** and **91.90% functions**. The **10-test** background/HTTP suite also passes on Node **22.13**. Architecture checks pass **189 modules / 923 imports**. Package validation passes **386 files / 1,912,857 unpacked bytes**; the actual temporary-prefix installer starts the installed worker, verifies a completed capture and stops it.

The new scenarios cover Claude, Codex and DSH capture, external appends, preserved revisions, explicit source selection and saved custom roots, source disappearance/replacement/recovery, retry after Hub lock contention, duplicate process rejection, explicit restart after a crashed idle owner, replaced Hub directories and empty/invalid selections. Scoped grants, revocation, source exclusion and conversation deletion markers remain effective during background work. Native fixture bytes remain intact. An unconfigured stop creates no Hub or recovery directory. Hard crashes during a mutation can still leave a Hub operation lock requiring inspected recovery; the idle-owner test does not claim automatic crash recovery for transactions.

Authenticated HTTP tests reject missing tokens, unknown source IDs and path injection, then close/reopen the UI server while retaining the selected worker. A separate isolated end-to-end run closes the HTTP server **before appending a new message**; the worker captures that message on its next scheduled pass and retains both revisions. No live client store was modified or captured for this work.

A separate headless browser profile passes empty-selection guards, one-switch enable/stop, locked source controls, capture, reload and retained selection, with no runtime exceptions or overflow at desktop and 400px widths. Screenshots were inspected. All test workers, servers and browser profiles were stopped/cleaned; no background capture was enabled on real data. OS startup installation, automatic reboot/crash supervision, native session continuation and all-area reconciliation remain separate capabilities.

## Nested instruction envelopes — 2026-11-06

`npm run check` and standalone coverage pass **314 tests**; coverage is **93.07% lines**, **85.27% branches** and **90.97% functions**. The targeted **23-test** client-title/title/presentation/sorting suite also passes on Node **22.13**. A synthetic browser run covers nested wrappers, normal/All-events access, reload and desktop/400px layouts without exceptions or overflow.

Package validation passes **374 files / 1,863,361 unpacked bytes**, and the real temporary-prefix installer passes.

Known runtime wrappers are matched by nesting depth rather than the first closing tag. Markdown fenced/inline code, indented examples and blockquoted tag examples do not close the outer instruction envelope. Complete leading AGENTS blocks and following environment blocks remain context; mixed requests retain their task text. Unbalanced blocks and quoted/user-written markup remain messages, as do records with attachments. Previously derived titles beginning with a leftover known closing tag are re-evaluated from their preserved original events, without deleting arbitrary tags from user messages.

Two new regressions cover nested wrappers, literal tag examples, old leftover-tag titles after source removal, unchanged catalog/raw bytes, complete-event access and unbalanced/mixed/attachment cases. A read-only check of both reported-date chats found task titles rather than technical prefixes or untitled fallbacks. No real archive or client files were changed.

## Codex and DSH conversation names — 2026-11-06

`npm run check` and standalone coverage pass **312 tests**; coverage is **93.17% lines**, **85.27% branches** and **90.96% functions**. The targeted **21-test** client-title/title/presentation/sorting suite passes on Node **22.13**. The final regressions also ensure that runtime-looking text accompanied by an attachment stays a message.

Package validation passes **374 files / 1,859,846 unpacked bytes**, and the actual temporary-prefix installer passes.

Codex environment and AGENTS/user-instruction envelopes are treated as context only when complete and standalone; mixed requests retain their human text and quoted/incomplete examples remain messages. Known approval-history prompts derive **Approval review**, and known terminal build-output headers derive **Build output**, without dropping those archived messages. DSH metadata marked `fallback` cannot override the full task excerpt; provider/user titles and delegated-task labels are retained. Previously captured fallback catalogs are repaired at read time without native-source access or catalog/raw-byte changes. Long excerpts end at a word boundary with an ellipsis; sessions with no identifiable task keep an honest untitled fallback.

Six new regressions cover the native formats, explicit-name precedence, old catalogs, quoted content, raw/original-event preservation and safe truncation. A synthetic browser scenario passes Codex task/review/build labels, DSH full-task/provider/descriptor labels, reload, normal versus All events and desktop/400px layout without overflow or runtime exceptions. A read-only check of the latest 100 existing chats found no reported environment/approval/AGENTS/build-header title prefixes, 38 concise approval-review labels and eight sessions without a derived task. No real titles, messages or credential values were printed or rewritten.

## Native date sorting — 2026-11-06

`npm run check` and standalone coverage pass **306 tests**; coverage is **93.05% lines**, **84.93% branches** and **90.93% functions**. The targeted **13-test** sorting/title/HTTP suite also passes on Node **22.13**.

Package validation passes **374 files / 1,853,912 unpacked bytes** and the actual temporary-prefix installer passes.

All data → Chats defaults to newest displayed native first-record date first; the Date selector also supports oldest first. Sorting covers the full filtered inventory before pagination. Missing timestamps stay last in both directions, equal dates retain catalog order and no date is replaced with archive capture time. UI direction is kept in the URL across filters, paging and reload; changing it resets the page offset. Overview uses newest-first too. Message search keeps event-search order; existing CLI/MCP list calls without an explicit sort retain their previous archive order.

Regressions verify global order across one-item pages, both directions, unknown dates, unchanged catalog bytes after native-source removal, filters/grants, ties and HTTP enum validation. A synthetic browser run passes default order, direction changes, URL/reload, client filter retention, offset reset, Overview and 400px layout without overflow or runtime exceptions. A read-only cold query over 586 existing chats took approximately 2.26 seconds using at most eight concurrent bounded prefix readers; only dates/summary counts were inspected, no private titles or messages printed. No native client files or archive catalogs were rewritten.

## Native conversation time — 2026-11-06

`npm run check` and standalone coverage pass **303 tests**; coverage is **92.95% lines**, **84.89% branches** and **90.92% functions**. The targeted **18-test** history/presentation/navigation suite passes on Node **22.13**.

Package validation passes **374 files / 1,850,774 unpacked bytes** and the real temporary-prefix installer passes.

Chat rows and open conversations show the date/time of the first available native record, in the browser’s local timezone. The tooltip includes the timezone. Missing or invalid source clocks remain unavailable; archive capture time is never used as a substitute. Existing catalogs obtain this read-only projection from a bounded saved-event prefix without native-source access or catalog migration. DSH session creation clocks and Codex session metadata are supported.

New regressions cover valid native time after malformed/missing values, offset normalization, explicit-title preservation, reading after source removal, unchanged catalog/raw bytes and safe unknown-time rendering. A read-only sample of 50 existing chats found native times for all 50 in approximately 363 ms without printing private titles or messages. A synthetic browser scenario passed list/open-conversation time, Europe/Moscow conversion, unknown-time labels and desktop/400px layout without overflow or runtime exceptions. No real archive or client files were changed.

## Existing Hub connections across installations — 2026-11-06

`npm run check` and standalone coverage pass **300 tests**. Coverage is **92.82% lines**, **84.76% branches** and **90.92% functions**; architecture remains **183 modules / 897 imports**.

New regressions reproduce false conflicts when clients use another Node or Agent Hub package path. Matching requires the same physical Hub and exact server, a supported unmodified launcher shape and readable package/bin metadata for a different installation. Discovery reads files without executing client commands. Working launchers remain in place during sync, including when delivering another server; client policies and unrelated entries are retained. Different Hub targets, missing or unrelated installations, extra arguments/environment, working-folder overrides and unknown launch settings still require review. Hub wrappers are not offered as original sources to import. A missing installation after preview blocks fresh application before any client write.

A targeted **33-test** connection/comparison/sync suite passes on Node **22.13**. A fresh headless-browser scenario confirmed that three clients using another installation show matching Hub connections, batch delivery previews no changes and all client bytes remain unchanged. Adding an environment override restores the review state without offering that wrapper as an import source. Desktop and 400px mobile screenshots were inspected; credentials stayed hidden and no runtime exceptions or page overflow occurred.

Package validation passes **374 files / 1,847,905 unpacked bytes** and the actual temporary-prefix installation passes. Normal global installation and published artifacts were not changed.

A read-only check of the reported real server confirmed all three client entries are connections to the same Hub, with no differing launch fields. No credentials or raw client definitions were printed and no real client configuration was applied.

## MCP settings choices — 2026-11-06

`npm run check` and standalone coverage pass **296 tests**. Coverage is **92.87% lines**, **84.63% branches** and **90.91% functions**; architecture verifies **183 modules / 897 imports**.

A targeted **29-test** MCP comparison/sync suite also passes on Node **22.13**. Package validation passes **374 files / 1,840,297 unpacked bytes**; the actual temporary-prefix installation passes and serves the new MCP assets and comparison API.

Six new regressions cover effective configuration comparison, credential redaction, client-only policies, exact Hub launcher recognition, ambiguous duplicate entries, known-name-only HTTP reads, origin checks, setup states, explicit copy directions and retaining the selected server after setup. The read-only comparison does not return raw native fields, credential values or private fingerprints.

A separate headless-browser run used only the synthetic QA profiles: cancelling an import left all native files byte-identical; choosing Claude then Codex copies changed only Hub; explicit delivery replaced only the named server in Claude; a late external edit rejected the old preview and survived a fresh reviewed apply. Other client files, unrelated entries and local settings were preserved. Adding the missing DSH connection was reviewed separately. Desktop/mobile screenshots were inspected; the 400px page had no horizontal overflow or runtime exceptions. Technical settings stayed collapsed and the synthetic credential was absent from DOM content. No real client configuration was applied.

## Readable lists and project locations — 2026-11-06

`npm run check` and standalone coverage pass **290 tests**. Coverage is **92.61% lines**, **84.35% branches** and **90.74% functions**; architecture verifies **180 modules / 884 imports**. A targeted **19-test** title/presentation/navigation/project-view suite also passes on Node **22.13**. Package validation passes **369 files / 1,814,793 unpacked bytes** and the actual temporary-prefix installer passes all existing workflows and the new project asset.

New regressions cover standalone Claude terminal notices, multiple command wrappers, greeting-only prefixes, pasted-content title wrappers, explicit native-title precedence, literal quoted/mixed-content requests, old catalog repair after native-source removal and exact original event/byte preservation. A missing derived index leaves its row visible with a review warning; actual unreadable event access still fails, cancellation still propagates and catalog bytes are unchanged. A read-only check of the first 50 existing archived chats found no remaining technical title prefixes, one title-index warning and approximately 250 ms list time. No private titles or bodies were printed, copied to fixtures or rewritten.

Project cards show one recorded representative/root path. Child locations, worktrees and dependency directories stay in expandable details; ordinary and unavailable/unverified folders have separate groups. Pure view tests cover Git roots, custom metadata directories, linked worktrees, path boundaries, Windows separator syntax, clone/nested-project separation, search and unchanged inputs. This display change does not alter backend identities, bindings, grants or catalog associations.

A separate temporary-browser run passed six synthetic chats, normal/all-event visibility, details, client filtering/reload, shared overview rows, project folder disclosures, missing-folder separation, search through hidden child paths and a 400px viewport without overflow or runtime exceptions. Desktop/mobile screenshots were inspected. Real client settings and archive/index files were not changed. No normal global reinstall, push, release or deployment was performed.

## Local interface rebuild — 2026-11-06

`npm run check` passes **279 tests**, formatting, lint, strict types and architecture checks (**178 modules / 877 imports**). Standalone coverage passes all 279 with **92.76% lines**, **84.18% branches** and **90.68% functions**. A targeted **36-test** navigation/architecture/sync run also passes on Node **22.13**; this is not a fresh full-suite minimum-runtime claim.

The interface now has Overview, All data and Projects, with secondary Sources & settings. Browser modules use enforced downward slice boundaries; the 765-line shell exception is removed. The shell is 243 lines, action controllers retain reviewed-plan state, and styles have separate responsibilities. No frontend framework, production dependency or remote font/script was added. Existing resource bookmarks remain accepted.

A separate temporary browser profile exercised **113 synthetic conversations** on desktop and a **400px** viewport. Capture, message search, search from an open conversation, normal/all-event DSH views, reload, escaped native markup, source selection, project views, skills and memory controls, setup/import/sync previews, old links, keyboard search and read-failure retry passed. Expanded details and focused source controls survive background refresh; clearing every source stays cleared and disables capture. Mobile pages and setup/import/sync dialogs had no horizontal overflow. Final screenshots were inspected. Terminal command copies remain accessible in collapsed disclosures.

The browser also applied an import and a single-item Claude MCP delivery, then ran connection checks, using only fixture files. Codex and DSH configurations stayed byte-for-byte unchanged during targeted Claude delivery. This exposed a pre-existing HTTP replacement bug: the route checked the preview but omitted its revision when calling the replacement guard. The route now forwards that validated revision. An actual HTTP regression verifies explicit replacement, unchanged unrelated settings/files, one-use consumption and rejection after an external edit. It does not weaken the core approval requirement.

Package validation and the real temporary-prefix installer cover every moved browser module and stylesheet, both CLI binary names, quick setup, full history capture/search/read, scoped Codex history connection and metadata discovery. Test/browser artifacts stay outside the package. No production client configuration was applied, normal global CLI installation changed, remote CI run, release or deployment performed for this rebuild.

## Readable DSH conversations — 2026-11-05

A user trial exposed a missing native envelope: DSH stores message bodies in `data.message.content` or `data.content`. The initial fixtures proved preservation but missed this display shape. The corrected projection extracts message text, parts, IDs, numeric timestamps and native titles. Conversation mode hides explicit runtime context/lifecycle events and duplicate tool transport echoes; All events retains access to every indexed record. Reasoning, tool arguments/results and unknown blocks are expandable. Old generic indexes are interpreted from their preserved raw records at read time, without native reads, reimport or archive writes.

`npm run check` and coverage pass **273 tests** with **92.81% lines**, **84.42% branches** and **90.68% functions**. Architecture checks pass **168 modules / 852 imports**. Four new presentation regressions also pass on Node **22.13**: real DSH envelope shapes, filtered native-ordinal windows/tool echoes, old-index compatibility after removing the source, and Claude/Codex content blocks. A read-only check of the reported existing archive confirmed readable user/assistant/tool projections and a resolved title; private contents were not added to fixtures or reports.

Browser checks on an independent synthetic DSH fixture pass conversation/all-events switching, reload, scoped search views, initially collapsed reasoning/results, inert escaped HTML, desktop and 400px mobile layout, with no runtime exceptions. Screenshots were inspected. Package validation and the real temporary-prefix installer pass, including the new renderer asset and existing history capture/read/client connection flow. No new dependency, production client apply, global user installation, release or deployment was performed.

## History archive — 2026-11-05

The final `npm run check` passes **269 tests**, formatting, lint, strict TypeScript and architecture checks (**165 modules / 842 imports**). All **269** also pass on minimum Node **22.13.0**. The final standalone coverage run passes with **92.60% lines**, **84.34% branches** and **90.64% functions**. One earlier coverage run overlapped a complete minimum-runtime suite and failed the existing short-contention automatic-writer test; the standalone retry passed without changing retry code or thresholds. Production dependency audit reports **zero vulnerabilities**.

The 26 new scenarios cover exact original bytes and unknown events, end-of-message search and complete windows, native edits/truncation/torn tails, old revision pagination, source disappearance, asset boundaries, checked Zstandard frames/checksums, durable unit cancellation, shared-block deduplication/integrity, grants/revocation/exclusions/deletion markers, reused native paths and replaced project identities. They also exercise HTTP protections, CLI from an unrelated directory, MCP retrieval and actual generated launcher execution, three-client reviewed delivery, stale connection rejection and memory-project disconnection revoking archive access. Literal and cyclic DSH YAML profile fixtures never execute plugins. These are isolated supported-format fixtures, not a claim that every native version or all proposal cases passed.

Package validation passes with **342 files / 1,746,636 unpacked bytes**. It used a disposable npm cache after the sandbox blocked the default cache. The actual standalone installer passes in a temporary prefix, including both binary names, quick setup, complete history capture/search/read, reviewed Codex history connection, UI assets and read-only project discovery. No normal global CLI installation was changed. The archive adds the small `fzstd` decoder and explicitly declares the already installed Zod schema dependency; other locked package versions are unchanged.

Browser QA used a separate temporary profile and **112 synthetic conversations**. Automatic metadata discovery, capture, pagination, full-event search, search pagination/reload, original-event reading, persisted project cards, reviewed client connection and revocation all passed. Desktop and 400px mobile screenshots were inspected; no horizontal overflow or runtime exception was found. Native client configurations in that run belonged only to the fixture.

Full supported-file capture is now implemented; [HISTORY.md](HISTORY.md) defines its limits. External attachment grants, arbitrary runtime-template/back-end resolution, native project APIs, native cross-client continuation, an installed background service, multi-device replication and a complete UI redesign remain separate work. No real private transcript archive or new remote CI/release/deployment was performed by this verification.

## Structural refactor — 2026-11-05

`npm run check` passes **243 tests**, formatting, lint, architecture checks and strict TypeScript. All **243** also pass on minimum Node **22.13.0**. Coverage on Node 25.2 is **93.07% lines**, **84.97% branches** and **90.91% functions**. Architecture checks inspect **137 modules and 720 imports**; negative fixtures cover prohibited dependencies, unresolved imports and runtime cycles. An isolated Git regression verifies that an explicitly selected Hub cannot mutate the unrelated default Hub.

Package validation passes with **286 files** and **1,492,332 unpacked bytes**. The real installer passes in a temporary npm prefix, including both executable names, quick preview/apply, status, UI assets and a read-only discovery job from an unrelated directory. Clean builds remove stale output after source moves. The user's global installation is unchanged.

A separate browser profile and synthetic 112-group fixture pass discovery progress, cancellation/retry, retained details/focus, 100-row pagination, cross-page search, stale results after failure, refresh, reload reattachment and source deselection. Desktop and 400px mobile screenshots were inspected; no runtime exceptions or horizontal overflow were found. Browser layout and behavior were retained, with the existing browser shell's size exception documented in [the code guide](CODE_GUIDE.md).

These are local macOS checks, not a new remote CI run or real-client working trial. This refactor adds structure and guardrails; automatic inventory, all-area reconciliation and a full conversation archive remain implementation work described in [the proposal](proposals/simple-hub/README.md).

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

`npm run install:check` packs and installs a standalone tarball using npm's global mode with a disposable prefix and isolated client/Hub paths. It deletes the source archive, verifies the installed package is a directory with its own dependencies, and checks both executable names, quick preview/apply, status and the live UI from an unrelated directory. The user's normal global prefix is untouched. End-user installation uses `npm ci` then `npm run install:global`.

## Shared Hub versus optional project connection

The current command scopes supersede the combined quick workflow described in the earlier trial notes. `ahub quick` now configures shared MCP, skills and instructions only, from any folder. `ahub project connect [directory]` independently configures one Git project's memory, handoff and hooks after Hub setup.

The suite contains 184 tests. Scope regressions verify that Git cwd and project-note changes do not affect a shared Hub preview; quick creates no repository files or project hooks; connection rejects a missing Hub, invalid Git directory and stale native notes; pending global instruction/tool/skill state is not delivered during project connection. HTTP tests reject project options on quick routes, keep connection bound to the UI startup project and prevent cross-scope preview application. The isolated global-install check now exercises plain `ahub quick` from a Git checkout and separately previews `ahub project connect` without a path.

Browser QA verified the separate shared Hub preview and applied the project-only workflow against temporary profiles. UI copy distinguishes Hub storage from the selected project directory, shows separate setup actions, labels plain sync as MCP-only and removes stale claims that repository initialization is future work. Native activation and the usefulness of model-selected knowledge still require the maintainer's working trial.

## Prioritized usability completion

The current regression suite covers preview-first MCP import and exact approval, explicit source selection, per-item delivery with preserved unselected ownership, terminal confirmation, canonical record counts, registered checkout identity checks, project-switch preview invalidation, shared-only UI gating, disconnected access and reconnection, per-workflow undo after fresh/partial setup, later-edit refusal and independent first-baseline reset. The workflow holds a reentrant lock while nested stages retain their own input checks. Production client profiles are not applied in these checks.

Standalone global-install verification installs a locked tarball copy into a disposable prefix and runs the installed CLI/UI after deleting the source archive. Automated HTTP checks validate functional UI behavior. A new rendered browser pass and the maintainer's real-client usefulness trial remain separate manual checks.

Final local verification: **194/194 tests passed on Node 22.13.0**, with 92.36% line, 84.62% branch and 89.96% function coverage. Formatting, ESLint and TypeScript passed. The 220-file package and its standalone global CLI/UI installation passed in temporary storage on Node 22.13.0. Website checks are maintained in the separate documentation repository; no deployment was performed.

The simplified CLI surface passes **199/199 tests** on the normal runtime and Node **22.13.0**. Minimum-runtime coverage is **92.11% lines**, **84.52% branches** and **90.27% functions**. Formatting, lint and type checks pass. All supported commands have a caller/purpose catalog, default help exposes six everyday groups, and advanced/runtime spellings remain callable. A real terminal fixture verified decline without Hub creation, confirmed setup and confirmed undo to absence. The **223-file** package and standalone install passed on Node 22.13.0; the production dependency audit reported zero vulnerabilities. The separate guide now has 16 translated documentation pages per language plus English/Russian landing routes; deployment remains maintainer-managed.

## Beta candidate preparation

Candidate 0.1.0-beta.1 adds four installer regressions: array/object npm pack metadata, cleanup after installation failure and fallback from another package manager's generic CLI. The standalone installation check now runs the actual end-user installer with a disposable global prefix and isolated cache/client paths, and verifies the installed executable version. Release preparation requires clean Git state and creates source/package archives with hashes and an exact-commit manifest. The guide adds a seventeenth documentation page for beta installation and publication gates.

Two additional release regressions reject mismatched tags/checkouts and implicit releases without a tag. The GitHub workflow prepares drafts only after the full platform/runtime matrix and secret scan pass; it refuses to update published releases. The website uses GitHub source and Releases links instead of bundling archives.

The earlier results above are historical snapshots. Candidate verification must run against the exact publication commit from a clean checkout; [RELEASE.md](RELEASE.md) lists the commands and open manual gates. Local checks do not establish remote CI success, browser layout quality or useful model-selected memory in real sessions.
