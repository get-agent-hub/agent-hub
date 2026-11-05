# Delivery and acceptance

[Proposal](README.md) · [Relationships](RELATIONSHIPS.md) · [Evidence](EVIDENCE.md)

This is an implementation plan, not completed work. Each slice should leave a usable product. Preserve current supported behavior and recovery throughout; keep the published beta tag immutable.

## What is covered, and what has actually been verified

The matrices below describe required outcomes. A listed case is not a passing test. The first read-only metadata discovery slice has isolated implementation tests; all-content reconciliation and chat archive still await implementation. [POLICIES.md](POLICIES.md) defines the decisions each slice must enforce.

Existing source tests cover important foundations: scoped memory/MCP access in `tests/memory.test.mjs`, native-memory conflicts/deletions in `tests/memory-consistency.test.mjs`, config and link guards in `tests/sync.test.mjs` and `tests/content.test.mjs`, HTTP protections in `tests/ui.test.mjs`, and interrupted writes/disk-full recovery in `tests/reset.test.mjs`. These contracts must be retained and extended. The follow-up review inspected those tests; it did not rerun them or establish coverage for future features.

During implementation, record each case as required, implemented, automated-test passed, or manual trial passed, with the corresponding test/commit/report. Keep these statuses separate. A fixture test does not prove real-client compatibility, and the current macOS/Linux CI matrix does not establish Windows support.

## First working increment: local Claude project discovery

The first real-data trial exposed incomplete enumeration. The follow-up now fixes R01–R11 within the supported initial-metadata scope; [DISCOVERY_REVIEW.md](DISCOVERY_REVIEW.md) retains the findings, resolution and remaining catalog boundaries. Discovery is not comprehensive conversation ingestion.

Implemented in `src/adapters/claude-sessions.ts`, `src/core/project-discovery.ts`, `src/ui/project-discovery.ts` and the UI Projects page. An explicit token-protected request reads selected configured sources, returns metadata/counts, groups verified worktrees and keeps ordinary/missing/unverified folders. It writes no catalog, settings, native history or project binding. No automatic source scan on page load, new CLI command, installed service or runtime dependency.

One action inventories and reads collections round-robin in small batches, with progress, Stop and server-retained continuation across polling/reload. Production safety ceilings are 200,000 entries, 100,000 files, 256 MiB reads and 1 MiB initial metadata per file; ordinary context remains the initial 64 KiB. Grouping separately bounds 5,000 location-cache entries, 2,000 groups, 100,000 observations and 128 locations/group. Oversized source records remain explicitly unresolved. Responses page at most 100 rows and about 128 KiB of row data. Git processes have a one-second timeout; a ten-minute job timer cancels cooperatively. Native filesystem calls have no hard deadline. Restart/Stop does not preserve a durable cursor. Complete coverage refers only to the selected supported metadata scope.

`tests/project-discovery.test.mjs` now includes 29 tests: foundations plus exact thresholds, large valid UTF-8 records, fair collection traversal beyond the old byte cap, directory changes, cancellation, failed Git verification, malformed unrelated client settings, result capacities, paginated/queryable HTTP jobs, previous results and safe Reveal references. Discovery IDs do not authorize registered-project memory.

Verification on 2026-11-05: full check and coverage passed 234 tests. Overall coverage: 92.89% lines, 84.98% branches, 90.39% functions. The 29 discovery tests also passed on Node 22.13. A separate headless browser profile exercised 112 synthetic groups, pages, filtering, progress, Stop/retry, stale results, Refresh/reload reattachment, retained details/focus and desktop/mobile layout; screenshots were inspected. The package check verified 234 files / 1,467,368 bytes unpacked; the real installer passed in a temporary prefix, including a read-only discovery job from an unrelated folder. The repeated selected real Claude source listed and checked 82 files (4,821,387 bytes), returned 17 groups and reported complete supported initial-metadata coverage with zero unresolved/skipped files in about 0.6 seconds. The old trial had stopped at 73 files / 15 groups under its 4 MiB cap. This single local observation is not a performance benchmark or evidence of a complete chat archive. No private names or message bodies were retained in the report. No claim that all 47 future cases or real-client formats passed.

Remaining work in slice 1: more client readers and native project/remote-environment contracts, durable IDs/aliases and user corrections, scoped resource inventory, and the unified setup review. Preserve the existing explicit write-authorized project registry during this work.

## Case ownership and completion gates

Case IDs below are stable. A case can span slices; only the tested subset is verified. Every case has an implementation gate:

| Slice                                                    | Required cases                                                                                               | Current evidence                                                                                                      |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| 1a: explicit Claude metadata discovery                   | C01, C11, C12, C13, C15, C17, C18, C32, C46                                                                  | Metadata subsets verified by the isolated discovery suite; broader identity/archive/platform outcomes remain required |
| 1b: durable catalog, native grouping and scope inventory | C11, C12, C14, C29, C37, C46                                                                                 | Required; no claim that transient discovery completes these                                                           |
| 2: reconciliation, connection ownership and recovery     | C01, C02, C03, C04, C05, C06, C07, C08, C09, C10, C26, C27, C28, C33, C34, C35, C38, C43, C45, C46           | Required; retain existing guarded-write/recovery tests and add tests for all-content operations                       |
| 3: optional worker and live resource refresh             | C24, C25, C47                                                                                                | Required; verify restart, missed events and runtime/config separation                                                 |
| 4: archive, grants, source fidelity and retrieval        | C12, C13, C15, C16, C17, C18, C19, C20, C21, C22, C23, C30, C31, C32, C36, C37, C39, C40, C41, C42, C44, C46 | Required; end-to-end ingestion, access, retention and recovery evidence before claiming preservation                  |

Before closing a slice: implement its policy, add failure-oriented fixture/integration tests, run `npm run check`, coverage and package checks, then record a separate real-client/manual trial. A failed or skipped gate stays visible; do not mark the entire matrix passed after a subset run.

## 1. Find sources and projects; make the first result clear

Extend adapters with explicit metadata/resource capabilities. Start with supported clients and source-qualified IDs. Read selected chat metadata and native project assignments; discover non-Git folders, repository roots and worktrees. Show projects without registration. Preserve coverage/errors and offer custom sources only for known formats.

Use the existing setup orchestration for two screens: selection, then review/connect. Present shared tools/skills/instructions/notes in one list with type filters. Show chat metadata as discovered; do not label it archived. Keep project discovery read-only until connection is approved.

**Done when:** an isolated profile with existing chats yields meaningful project cards without entering paths, unrelated projects stay distinct, source failures are visible, and every proposed write has a readable scope/impact. Add client accurately shows partial capabilities. No speculative plugin host or generic graph storage is introduced.

## 2. Make one Sync operation real

Add per-connection comparison state and explicit all-content reconciliation. Keep existing type-specific writers. Recognize aliases and generated projections, preserve client-only fields, handle explicit deletion and record one operation with stage outcomes. Add recovery for the new operation scope before presenting universal undo.

**Done when:** a client edit reaches Hub and other unchanged connections, repeat sync writes nothing, divergent edits survive, and later-edit-safe recovery works across the supported operation. Existing MCP-only commands/JSON/callbacks remain compatible.

## 3. Add one optional automatic worker

Persist the selected policy; use the same reconcile path for manual and background work. Implement bounded passes, restart cursors, debouncing, self-event suppression and periodic scans. Show worker lifecycle in Settings; install startup behavior only through its explicit setup choice.

**Done when:** missed events are repaired by scanning, restart does not duplicate work, a conflict does not block independent changes and runtime tool outages do not rewrite healthy configuration.

## 4. Preserve and search chats incrementally

Metadata discovery from slice 1 is the first part of this feature. Add format-aware archive ingestion, source snapshots/events where available, normalized search views, explicit lineage and note provenance. Complete this slice before saying “your chats are backed up.” Read/search through UI and Hub MCP; let the agent fetch selected context.

**Done when:** selected supported content is preserved with declared coverage, duplicates and forks remain correctly distinguished, indexes rebuild, and native deletion does not remove the archive. Opening the original conversation and starting another client with selected context have honest labels. Native cross-client continuation remains unavailable until separately validated.

## Simplify and retain

Two implementation decisions need small fixture-based investigations before dependency selection:

| Decision              | Default direction                                                                           | Evidence needed to change it                                                                                 |
| --------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Native session access | Bounded local metadata readers; optional supported read APIs; no mandatory full agent SDK   | Format coverage, side effects, compressed-stream support, package size and maintenance cost for each adapter |
| Search storage        | Existing files for the first metadata catalog; a rebuildable local index for archive search | Measured corpus/query needs and a supported SQLite/FTS binding across the Node/platform matrix               |

Unsupported formats remain visible as unsupported sources. They must not silently disappear from the catalog or force installation of a whole client runtime. Native read APIs can improve coverage where verified, but Hub should not start model sessions to enumerate local history.

| Simplify/remove from ordinary flows                            | Retain or improve                                                     |
| -------------------------------------------------------------- | --------------------------------------------------------------------- |
| Separate import/delivery journeys per content type             | Existing parsers, guarded plans and writers                           |
| Mandatory manual project registration                          | Automatic discovery plus explicit write authorization                 |
| IDs, record kinds and provenance fields in ordinary note entry | Derived metadata, source links and structured API compatibility       |
| Long command catalogs on the landing                           | Advanced command reference and script compatibility                   |
| Planned-only UI pages presented as working features            | Visible capability/coverage status                                    |
| Repeated client format/path knowledge                          | One adapter/capability boundary                                       |
| Several general-purpose watchers                               | One optional reconcile worker; optional semantic hooks                |
| Whole-config copying and unconditional overwrite               | Individual links, native precedence, preserved settings and conflicts |

Do not rewrite storage, build a graph engine, add compulsory embeddings, install large SDK runtimes or merge all planners solely for architectural symmetry. Measure an actual need first. Reconsider extracting a generic helper after two real implementations establish the shared behavior.

## Functional acceptance matrix

Use injected temporary client profiles, synthetic sessions and controlled fixture APIs. Never run write tests against the user's real clients. Existing recovery, secret-redaction and unrelated-settings tests remain required.

| Case                                                           | Required observable result                                                       |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| C01 · First run and unchanged rerun                            | Correct selected content; second run has no writes or duplicates                 |
| C02 · Two clients edit different items                         | Both edits collected; independent updates proceed                                |
| C03 · Same item changes differently                            | Both versions retained; item-scoped choice; no timestamp winner                  |
| C04 · Deletion, old client returns                             | Recorded removal respected; unavailable source never treated as deletion         |
| C05 · Intact link edited / link replaced                       | One canonical edit / detected drift; no import loop                              |
| C06 · Hub launcher encountered during import                   | Original portable tool recognized; no recursive wrapper                          |
| C07 · Same MCP endpoint, different auth/profile                | Keep policy variants and credentials distinct; no secret in public reports       |
| C08 · Unrelated client settings                                | Byte/semantic preservation according to the existing format contract             |
| C09 · Scoped instructions or memory                            | No promotion to global; native precedence retained                               |
| C10 · Native Markdown and structured records                   | Text/metadata preserved; existing structured callers still work                  |
| C11 · Worktrees, clones, submodules, non-Git folder            | Verified grouping only; ordinary folders remain usable                           |
| C12 · Remote cwd / missing folder / folder move                | No false host resolution; history retained; accepted move preserves Hub identity |
| C13 · One chat touches several projects                        | Primary and explicit related associations survive rescans                        |
| C14 · Native project with multiple roots                       | Preserve source grouping without forcing one Git root                            |
| C15 · CLI and IDE show one stored chat                         | One archive entry; same IDs in different stores remain separate                  |
| C16 · Forks/subagents and absent lineage                       | Explicit family links preserved; common prefixes do not merge chats              |
| C17 · Partial pages, hidden/archived sources, permission error | Declared coverage; no false “all chats” or destructive absence inference         |
| C18 · Truncated/rotated JSONL; partially written record        | Resume/rebuild without lost complete events or duplicate identities              |
| C19 · DSH compressed/newer format                              | Verified framing or explicit unsupported status; no native repair/write lease    |
| C20 · Metadata available, body deferred/unreadable             | Catalog remains useful; archive status stays incomplete                          |
| C21 · Index corruption                                         | Rebuild from preserved archive without contacting a model                        |
| C22 · Completed vs proposed file/tool event                    | Only supported completed events count as actual activity                         |
| C23 · Client chat deleted                                      | Archive retained; explicit Hub deletion stays a separate action                  |
| C24 · Watch missed event/restart/overlapping commands          | Periodic reconciliation, persisted progress and lock prevent lost updates        |
| C25 · Stopped n8n/tool service                                 | Configuration remains intact; runtime unavailability shown separately            |
| C26 · Failure halfway through apply                            | Accurate partial result and recoverable recorded stages                          |
| C27 · Undo after subsequent user edit                          | Later edit protected with a clear explanation and recovery options               |
| C28 · Existing CLI calls and noninteractive usage              | Same documented scope/JSON; no unexpected prompt or expanded writes              |
| C29 · User correction/rejected grouping                        | Rescans preserve it; the same suggestion does not reappear repeatedly            |

Benchmark cold/warm discovery and ingestion with small and large fixture corpora, large single sessions and interrupted reads. Record wall time, peak memory, bytes read, progress responsiveness and archive/index size. Establish budgets from those measurements; API pagination alone is not evidence of bounded resource use.

## User validation before declaring the product simpler

Run an unassisted task trial with someone unfamiliar with Hub. Observe behavior rather than asking whether the screen “looks simple.” These are proposed acceptance tasks, not a completed study:

1. Set up two clients and explain which content will be shared before confirming.
2. Find an existing project's chat without registering the project or learning the word “workspace.”
3. Edit a connected skill and find the result in the second client.
4. Resolve one conflicting tool definition without affecting other tools.
5. Explain the difference between a source that could not be checked and deleted content.
6. Find a conversation from another client and identify whether it can be read, opened natively or only handed off as context.
7. Undo a Hub operation and find Restore original setup when needed.

Record where explanation was needed, mistaken scope assumptions, recovery failures and time to the first verified shared item. Fix those problems before reducing reference documentation. Keep the landing, EN/RU text and five entry guides synchronized with shipped capabilities after each slice.

## Additional boundaries found in the follow-up review

These are design/test gaps, not newly confirmed vulnerabilities in the beta. Set their policy while implementing the relevant slice; do not add separate beginner workflows for them.

| Priority | Boundary                                                          | Proposed simple behavior                                                                                                                                                                                                                                                                                      |
| -------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0       | Archive access across personal/work projects and profiles         | Central storage does not imply universal read access. Grant each MCP connection explicit project/shared read scope. A project grouping is not an authorization boundary by itself. Apply filtering before returning titles, counts, snippets or bodies.                                                       |
| P0       | Discovery versus execution                                        | Finding a tool, skill, hook or transcript must not run it, install its dependencies or grant its requested permissions. Treat archived instructions as quoted source material; retrieving them does not authorize their actions. This cannot guarantee a consuming model's behavior.                          |
| P0       | Three or more clients change one item; two Hubs manage one target | Compare all observations against their acknowledged versions before choosing updates. Preserve every divergent candidate. An existing connection owned by another Hub requires explicit transfer, not silent takeover.                                                                                        |
| P0       | Storage failure, interrupted archive writes and schema upgrades   | Publish data/checkpoints only after the corresponding archive segment is stored and validated. Preserve the last valid generation. A failed migration remains recoverable; an older reader must not rewrite an unknown newer format.                                                                          |
| P1       | Machine/profile portability and runtime dependencies              | Preserve portable definitions separately from local paths, executable availability, environment references and credential bindings. Moving Hub requires location review; syncing config is not proof a tool can run. Multi-device Hub replication is a separate capability, not implied by local client sync. |
| P1       | Full chat contents beyond text                                    | Track attachments, images, deferred outputs and external references explicitly. Preserve accessible selected assets with content checks; otherwise show what is missing. Never describe a text-only view as a complete archive.                                                                               |
| P1       | Edited histories, branches and compaction                         | Re-read changed history generations, not only appended bytes. Keep native edits/branches/compaction metadata and earlier preserved revisions according to retention policy; a normalized active conversation is one view.                                                                                     |
| P1       | Forgetting data and controlling size                              | Separate exclusion, disconnect, archive deletion and native deletion. Define deletion/retention for raw data, search indexes, snippets, caches and recovery copies. Disclose retained recovery copies; removing a source alone does not erase its archive.                                                    |
| P1       | Disconnect, uninstall and losing the Hub path                     | Offer a reviewed disconnect that materializes supported current shared content into native settings or restores the original setup. Explain remaining references. Never silently remove canonical content still used by connected clients.                                                                    |
| P1       | Filesystem/platform differences and branch switching              | Preserve identity through supported moves, refresh effective project resources after checkout changes and detect collisions. Validate platform-specific links, paths and permissions before advertising support.                                                                                              |

P0 means required for the slice that introduces the behavior, not a demand to implement every future feature before improving setup. P1 means required before claiming that particular portability/archive/platform feature. These are engineering acceptance conditions, not extra commands or a mandatory setup checklist.

Hub API scopes govern what Hub returns. They do not isolate applications that independently have filesystem access to the same archive. Revocation stops subsequent Hub responses; it cannot recall content already delivered or copied by a client. Stronger operating-system isolation and remote multi-user access are separate contracts and must not be implied by project filters.

## Additional acceptance cases

| Case                                                                                         | Required observable result                                                                                                                               |
| -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C30 · Project A requests project B history through search, direct ID or related-chat link    | Unauthorized titles, counts, snippets, assets and bodies remain inaccessible; combining project cards does not expand grants                             |
| C31 · Profile/account changes while a connection exists                                      | Grants and credentials are re-evaluated for the new binding; previous private access is not inherited by path/name alone                                 |
| C32 · Scan an executable skill or a chat containing tool/hook commands                       | No discovery-time execution, dependency install or permission change; retrieved text retains source/data labeling                                        |
| C33 · Three clients independently edit the same managed item                                 | Every candidate survives; result is independent of source traversal order                                                                                |
| C34 · A second Hub targets an already managed config/skill                                   | Ownership conflict is shown; explicit transfer preserves recovery and content                                                                            |
| C35 · Native client writes during Hub apply                                                  | Changed source/destination revisions invalidate affected writes; no false successful acknowledgement; already completed stages remain recoverable        |
| C36 · Disk full, interrupted write or corrupted archive segment                              | Last valid archive remains readable; progress is not advanced past uncommitted data; retry is idempotent                                                 |
| C37 · Upgrade fails or an older binary opens newer Hub data                                  | Original data remains available; unknown format is not overwritten; recovery instructions identify the supported version                                 |
| C38 · Hub moved/copied to another machine, executable missing or credential expired          | Local bindings are reviewed; no fabricated tool availability or silent account reuse                                                                     |
| C39 · Source store cloned and later diverges                                                 | Explicit store identity/alias policy prevents accidental merging or dropping distinct events                                                             |
| C40 · Images, binary assets, external links and deferred tool output                         | Asset/content coverage is visible; missing data is not presented as preserved; asset paths cannot escape their permitted roots                           |
| C41 · Earlier messages edited, same-sized file rewritten, branch/compaction changes          | Revision validation detects supported rewrites; index refreshes without silently losing preserved history                                                |
| C42 · User excludes a project, then reconnects or requests deletion                          | Exclusions survive scans; deletion scope and retained recovery copies are explicit; stale sources do not immediately reimport intentionally removed data |
| C43 · Old deletion records are compacted and an offline source returns                       | Full reconciliation/rejoin is required where needed; old content is not resurrected because a marker expired                                             |
| C44 · Search/API reads while indexing or updating grants                                     | Results use a consistent supported view and current grants; in-flight work does not expose newly excluded content                                        |
| C45 · Disconnect/uninstall, deleted Hub directory or broken Hub link                         | Preserve available content, report missing targets and provide reviewed native restoration/materialization; no destructive automatic reset               |
| C46 · Case/Unicode collisions, spaces, long paths, permission loss, read-only/offline volume | Bounded clear failure and no wrong-target write; unsupported platforms/filesystems remain explicitly unverified                                          |
| C47 · Checkout changes project-local instructions/tools while watcher is running             | Effective resources refresh without changing project identity or globally promoting branch-local content                                                 |
