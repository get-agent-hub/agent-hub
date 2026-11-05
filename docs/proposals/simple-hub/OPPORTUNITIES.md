# Where Agent Hub could be worth developing

Research and proposed validation · 2026-11-05 · reviewed Hub: `c1f7674`

[Initial Hansard comparison](HANSARD_COMPARISON.md) · [Delivery and acceptance](DELIVERY.md)

**Recommendation:** validate one small workflow for collecting existing resources, reconciling subsequent native-client edits and disconnecting safely. Do not resume a broad archive/orchestration roadmap merely to match Hansard. This is a product hypothesis, not a proven competitive advantage or an approved implementation change.

## Method and confidence

Reviewed official Hansard documentation, its previously downloaded `0.7.1` npm source, and three adjacent configuration projects. Read the current Hub implementation and existing test contracts. No competitor code was executed, personal data imported, native configuration changed or usability/performance benchmark run. Firecrawl had no credits; public documentation was read through the fallback web tool and GitHub's connected read API.

The evidence distinguishes documented behavior, limited source observations and proposals. A missing documented workflow does not prove the entire product cannot perform it. Public documentation can also lead a published package. There is no adoption, willingness-to-pay or representative demand evidence here.

Source pins for this review:

| Project                  | Reviewed source                                                                           |
| ------------------------ | ----------------------------------------------------------------------------------------- |
| Agent Hub                | `c1f767421241225df02759eb978725a10aa2fa19`                                                |
| Hansard                  | npm `hansard@0.7.1`; selected source files, not a complete code audit                     |
| agent-sync-sh/agent-sync | README and documentation; repository head `9269fd5206ab06ef84fa87e1db63d1f3c9ef03c6`      |
| dallay/agentsync         | README and MCP guide; repository head `8134eaf7641d9ddb875125906f8cd8c3a373517a`          |
| Helter5/agentbridge      | README plus `mcp-sync.ts` and `rollback.ts` at `5d02b8e0fe6fd95d11b3edece04019e08c834603` |

The two similarly named sync projects above are independent products.

## The competitive space is wider than Hansard

Hansard already covers the archive, retrieval and cross-agent sharing space. Its main documented tool-sharing mechanism is an MCP bridge, but it also keeps plugins for project environments. A bridge is an architectural choice, not evidence of worse usability. [Skills and MCP](https://www.hansard.dev/guides/skills-and-mcps/).

Native configuration sharing is also occupied:

- **agent-sync** adopts existing files and MCP entries into a canonical `.agents` directory, links suitable resources, renders other formats, preserves foreign entries and supports per-agent tweaks. Its MCP adoption checks that rendering reproduces the native definition. Its documented ownership policy makes Commons win for managed names; it deliberately leaves cross-machine synchronization to Git/chezmoi. [Documentation](https://agent-sync.sh/docs).
- **AgentSync** generates native MCP configuration from a manifest. Its merge policy prefers that manifest on a name collision. It also records original files and restores them only if their managed state still matches: later edits, changed links and missing owners can block restore. Guarded rollback is therefore not ours alone. [MCP guide](https://dallay.github.io/agentsync/guides/mcp/).
- **AgentBridge** links shared skills and merges native MCP settings. Its README describes conflicting fields being resolved by processing order, with warnings. The reviewed merge code collects collisions while constructing the merged result. This is a candidate comparison against preserving both alternatives for an explicit choice; it is not a claim that every caller necessarily applies that result. [README](https://github.com/Helter5/agentbridge/blob/5d02b8e0fe6fd95d11b3edece04019e08c834603/README.md), [merge source](https://github.com/Helter5/agentbridge/blob/5d02b8e0fe6fd95d11b3edece04019e08c834603/src/core/mcp-sync.ts#L255).

Consequently, a common directory, symlinks, discovery, a small CLI, backups and preserving unrelated keys are useful foundations, not a sufficient public-product distinction. A focused workflow must beat both Hansard and a configuration synchronizer.

## Ranked opportunities

These priorities rank experiments and development dependencies. They do not mark a feature implemented or a market gap proven. Effort is relative to our current code, not an estimate in days.

| Priority | Candidate outcome                                                                 | Why it could matter                                                                             | Existing Hub foundation                                                    | Missing work / relative effort                                                               | Evidence confidence                                                                             |
| -------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| P0       | Edits made in either native client propagate without silently losing another edit | Users can keep their normal editing workflow instead of remembering the one authoritative file  | Imported definitions, guarded planners, ownership, native-memory conflicts | General connection baselines, semantic comparison and reviewed conflict resolution; high     | Concrete policy differences in adjacent tools; demand and comparative runtime behavior untested |
| P0       | One understandable connect → use → disconnect workflow                            | A user gets a working shared setup and can leave it without guessing which files changed        | Quick orchestration, source discovery, baseline/reset/undo                 | One review/result surface and integration of reconciliation; medium UI work after the engine | Existing primitives verified; superior usability unproven                                       |
| P1       | A project knowledge store that agents can safely update concurrently              | Decisions and conventions remain usable across clients without depending on a full chat archive | Scoped memory MCP, revision checks, native imports, pending conflicts      | Clear defaults and native-client usefulness trial; medium                                    | Current API distinction; no proof of better answers or universal isolation                      |
| P1       | Explain whether a tool is configured, reachable and usable                        | A stopped backend should not look like lost configuration or trigger destructive repair         | MCP initialize/tools-list probes and separate service readiness            | Generic capability-driven diagnostics and concise UI; low-to-medium                          | Inventory limitation is documented; product-wide diagnostic superiority unproven                |
| P2       | Reproduce a selected setup on another machine without copying private bindings    | Sharing a definition is different from sharing a token or absolute local path                   | Portable registry fields and environment references                        | Portable export, per-machine bindings and compatibility validation; high                     | Already partly served by Git/chezmoi and competitors; weak initial differentiation              |
| Defer    | Reuse another archive through an optional adapter                                 | Avoid rebuilding importers merely to retrieve prior work                                        | Current MCP/settings integration                                           | Versioned retrieval, provenance and enforced project scope; medium-to-high                   | Architectural possibility only; no integration trial                                            |

## P0: make native edits part of the normal Sync operation

The desired result is concrete: edit one managed MCP definition in Codex, run Sync, and see that edit in Hub and an otherwise unchanged Claude connection. Keep Codex-only approval settings local. If Claude independently changed the same shared definition, preserve both versions and ask once for that item. An unrelated skill can still synchronize.

Our current MCP sync primarily projects Hub definitions into native launchers; it is not this general bidirectional engine. Native-memory reconciliation already provides a narrower example. See [sync implementation](../../../src/core/sync.ts), [native memory reconciliation](../../../src/core/memory-auto-sync.ts) and [existing policies](POLICIES.md).

Use the existing planners and writers, with a small per-connection record of the last acknowledged shared meaning and projection. Compare Hub, observed client and that base. Preserve client-only fields through the adapter, rather than inferring portability from matching names. A generated Hub launcher must never be imported as a new server that launches itself.

Distinguish four actions in both policy and tests: a local override, removing one connection, deleting a shared resource and temporarily losing access to a source. Only an explicitly supported deletion becomes a removal record. Missing or incomplete observations are not deletion evidence. An intact skill link needs no copying; replacement of that link with a native regular file needs comparison before repair.

This state has a maintenance cost. Do not build a generic graph/entity framework to implement it. Begin with one resource type and two clients; extend the same contract to the third existing adapter and other resource types only after failure cases pass. Keep current APIs compatible. Add periodic automation only after explicit Sync is repeatable and a second unchanged run writes nothing.

Hansard's native memory editing/unification does not establish a deterministic all-resource reconciliation engine; the review did not find a documented equivalent to this complete workflow. Conversely, that absence is not proof that Hansard has no relevant protection. [Memory behavior](https://www.hansard.dev/guides/memories/).

## P0: make recovery and scope understandable

Recovery should be part of the same connection result: what was collected, what each selected client now receives, which differences remain and how to disconnect. Expose one concise plan; put paths and adapters in Details. Do not make a user select import, link, render and repair commands before getting a result.

Hansard already handles integration name collisions, preserves unrelated settings, retries missing parts and retains user-edited files when removing its managed integration. We cannot position it as a tool that blindly overwrites client settings. [Integration lifecycle](https://www.hansard.dev/guides/agent-integrations/).

Its documented reset clears Hansard data rather than restoring the machine's pre-install state; uninstall and archive-update recovery serve different scopes. This is a useful scope distinction for comparison, not evidence that Hansard lacks recovery. [Maintenance](https://www.hansard.dev/reference/maintenance/).

Our baseline/reset, workflow undo and stage restore already distinguish several recovery scopes. Surface those accurately before adding another command. Later independent edits should block an unsafe whole-file undo; retain current data and give a narrow reviewed route forward. Do not promise a merge-preserving universal undo or a power-loss-safe transaction. [Recovery contract](../../RECOVERY.md), [guarded transaction writer](../../../src/core/file-transaction.ts).

The potential advantage is the complete understandable lifecycle across selected resources, not the mere presence of backups. AgentSync already has a strong conditional MCP restore contract.

## P1: shared knowledge with explicit project access

Hansard's documented recall searches memories across projects unless filters narrow it. Filters are a retrieval choice, not necessarily an access boundary. That does not prove the absence of permissions in other Hansard subsystems. [Recall tools](https://www.hansard.dev/reference/provider-support/).

Hub already binds its memory MCP session to one workspace; request arguments cannot select another project. Shared reading and writing require separate server options, and writes use expiring previews plus revision checks. This is a concrete current API property. It does not isolate an agent that can independently read all local files. [Memory session](../../../src/core/memory-session.ts), [MCP surface](../../../src/mcp/memory.ts).

Develop this as a useful collection of decisions and facts: provenance, updates, disagreements and deliberate promotion to Shared. Keep native memory intact and account for its format. Do not turn every transcript into permanent truth or automatically merge differently worded facts with a model. Hansard already offers reviewed memory workflows, so extraction and review alone are not a distinction.

Validate usefulness with real tasks: can Claude retrieve and use a decision saved from Codex; can both update independent facts; does a stale replacement preserve the newer value; can a project connection retrieve another project's records? Protocol fixtures cover foundations, not whether a model actually uses them well.

## P1: tell configuration apart from runtime failures

Hansard explicitly says its skills/MCP inventory does not test server responses or sign-ins. It also has diagnostics and activity evidence elsewhere; the inventory limitation is not a product-wide absence of diagnostics. [Inventory](https://www.hansard.dev/guides/skills-and-mcps/).

Our current doctor separates process/protocol phases from optional backend readiness. Make those distinctions useful in one item: configured; client activation unknown or observed; MCP responded; service unavailable or unknown. The user's intentionally stopped n8n service is a representative scenario. Missing readiness support must remain unknown, not healthy. [Doctor types](../../../src/core/doctor-types.ts), [service checks](../../../src/core/doctor-service.ts).

Favor declared readiness capabilities and a small extensible adapter boundary over a growing set of brand-name checks. Run only authorized diagnostics; tool enumeration is different from invoking a tool. Do not promise that a successful tools/list response proves every operation works.

## Defer portability and archive expansion

Hansard Personal Sync preserves separate device memory copies and does not rewrite another device's provider memory files. This leaves room to test reproducible native setups, but it is a different task from archive replication. [Personal Sync](https://www.hansard.dev/sync/personal-sync/).

For a later portable setup, separate committable definitions from local paths, credentials, native permissions and recovery journals. First support Git/export/import rather than building a cloud synchronization service. Current recovery snapshots intentionally contain machine-local paths and may contain credentials; they are not a portable share format. Do not invent a new package/lock format before checking existing formats.

Keep chat discovery useful without requiring a Hub-owned archive. Explore optional external recall only after the core workflow passes: retain original source identity, verify version compatibility and enforce granted project scope. A model-provided filter alone is not authorization. Do not hand an otherwise restricted agent an unrestricted archive MCP connection or build a bridge loop. Integration is not yet implemented, and Hansard must not become a mandatory dependency.

Do not prioritize graph UI, broad transcript importer coverage, embeddings, account routing, helper orchestration, phone clients, team cloud sync or a skills marketplace for this validation. Local operation, MIT, small package size, a watcher and DSH support are not sufficient standalone reasons to choose Hub. There are no measured startup/RAM advantages yet.

## Comparative trial before committing to a larger roadmap

Run these tasks in isolated synthetic profiles against the current pinned versions, using each product's documented workflow. Mark unsupported, refusal, partial and successful outcomes separately. The table is a test plan, not a report of passed competitor tests.

| Case                          | Required observation                                                                                                   |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| T01 · Existing setup          | Collect selected existing resources; preserve unrelated settings and divergent same-name items                         |
| T02 · One native edit         | An approved client-side shared edit reaches Hub and unchanged selected peers                                           |
| T03 · Native-only field       | Preserve one client's policy/transport-specific fields or explain unsupported conversion before writing                |
| T04 · Concurrent edits        | Preserve both distinct revisions, ask for this item and allow independent items to proceed                             |
| T05 · Replaced skill link     | Recognize an atomic-save replacement as drift; do not erase the new file during repair                                 |
| T06 · Removal and outage      | Separate local removal, global deletion, disconnect and unreadable/offline source; do not resurrect or silently delete |
| T07 · Shared destination      | A shared physical skills root has all owners represented; an unselected owner cannot be changed silently               |
| T08 · Recovery after new work | Preview exact scope; protect later edits and retain originals/current data on failure                                  |
| T09 · One broken client       | A malformed or unavailable unrelated client does not prevent supported selected work                                   |
| T10 · Knowledge access        | Project-bound reads reject another project; stale writes cannot replace newer facts                                    |
| T11 · Stopped backend         | Show configuration intact and service unavailable/unknown without reinstalling or executing tools                      |
| T12 · Repeat and interruption | An unchanged repeat writes nothing; cancellation/restart reports completed and remaining work truthfully               |

Record manual actions, assistance needed, time to the first useful native result, files changed, lost settings, unresolved conflicts and recovery outcome. Test from both a clean profile and a used profile. Do not compare a tiny Hub metadata scan with a full Hansard archive import as a performance benchmark.

A proposed usability gate is five people who use at least two clients, with at least four finishing connect, native edit, sync and disconnect without assistance. This is a small qualitative gate, not statistical market validation. Ask whether they would keep using it and which existing tool they would replace; a pleasant demo is not enough.

## Build, contribute or stop

1. **First compare the complete task.** If Hansard plus an existing configuration tool already completes it clearly, prefer that combination or an upstream contribution.
2. **Build one missing vertical slice.** If native-edit reconciliation is the actual gap, implement that through the existing planner/recovery path and make its result reviewable. Do not build archive/orchestration in parallel.
3. **Keep it only if the outcome improves.** Continue a standalone Hub when the trial demonstrates fewer mistakes or fewer manual steps while retaining the required behavior, and users want it repeatedly. Otherwise contribute the useful safety/adapter work or keep a small personal tool.

The strongest candidate positioning is: **keep the tools and project knowledge in your existing coding clients consistent, while preserving local choices and showing exactly what changed.** This must be earned by the trial; it is not a current claim of uniqueness or superiority.
