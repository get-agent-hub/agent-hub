# Delivery and acceptance

[Proposal](README.md) · [Relationships](RELATIONSHIPS.md) · [Evidence](EVIDENCE.md)

This is an implementation plan, not completed work. Each slice should leave a usable product. Preserve current supported behavior and recovery throughout; keep the published beta tag immutable.

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

| Case                                                     | Required observable result                                                       |
| -------------------------------------------------------- | -------------------------------------------------------------------------------- |
| First run and unchanged rerun                            | Correct selected content; second run has no writes or duplicates                 |
| Two clients edit different items                         | Both edits collected; independent updates proceed                                |
| Same item changes differently                            | Both versions retained; item-scoped choice; no timestamp winner                  |
| Deletion, old client returns                             | Recorded removal respected; unavailable source never treated as deletion         |
| Intact link edited / link replaced                       | One canonical edit / detected drift; no import loop                              |
| Hub launcher encountered during import                   | Original portable tool recognized; no recursive wrapper                          |
| Same MCP endpoint, different auth/profile                | Keep policy variants and credentials distinct; no secret in public reports       |
| Unrelated client settings                                | Byte/semantic preservation according to the existing format contract             |
| Scoped instructions or memory                            | No promotion to global; native precedence retained                               |
| Native Markdown and structured records                   | Text/metadata preserved; existing structured callers still work                  |
| Worktrees, clones, submodules, non-Git folder            | Verified grouping only; ordinary folders remain usable                           |
| Remote cwd / missing folder / folder move                | No false host resolution; history retained; accepted move preserves Hub identity |
| One chat touches several projects                        | Primary and explicit related associations survive rescans                        |
| Native project with multiple roots                       | Preserve source grouping without forcing one Git root                            |
| CLI and IDE show one stored chat                         | One archive entry; same IDs in different stores remain separate                  |
| Forks/subagents and absent lineage                       | Explicit family links preserved; common prefixes do not merge chats              |
| Partial pages, hidden/archived sources, permission error | Declared coverage; no false “all chats” or destructive absence inference         |
| Truncated/rotated JSONL; partially written record        | Resume/rebuild without lost complete events or duplicate identities              |
| DSH compressed/newer format                              | Verified framing or explicit unsupported status; no native repair/write lease    |
| Metadata available, body deferred/unreadable             | Catalog remains useful; archive status stays incomplete                          |
| Index corruption                                         | Rebuild from preserved archive without contacting a model                        |
| Completed vs proposed file/tool event                    | Only supported completed events count as actual activity                         |
| Client chat deleted                                      | Archive retained; explicit Hub deletion stays a separate action                  |
| Watch missed event/restart/overlapping commands          | Periodic reconciliation, persisted progress and lock prevent lost updates        |
| Stopped n8n/tool service                                 | Configuration remains intact; runtime unavailability shown separately            |
| Failure halfway through apply                            | Accurate partial result and recoverable recorded stages                          |
| Undo after subsequent user edit                          | Later edit protected with a clear explanation and recovery options               |
| Existing CLI calls and noninteractive usage              | Same documented scope/JSON; no unexpected prompt or expanded writes              |
| User correction/rejected grouping                        | Rescans preserve it; the same suggestion does not reappear repeatedly            |

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
