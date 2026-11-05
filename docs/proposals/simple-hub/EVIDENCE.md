# Evidence and implementation constraints

[Proposal](README.md) · [Relationships](RELATIONSHIPS.md) · [Delivery](DELIVERY.md)

Reviewed 2026-11-05. Findings combine the public beta at `06c4960`, official documentation and pinned upstream source. No personal transcripts, native databases or production client settings were read or changed. No model calls were made. These are contract/source observations, not an end-to-end integration or usability pass.

Firecrawl was unavailable with HTTP 402; official pages and public source were read directly. Mutable documentation and experimental APIs must be checked again when implementing adapters.

## What the current beta already provides

| Area             | Evidence in the reviewed source                                                                  | Consequence                                                                      |
| ---------------- | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| Setup            | `src/core/quick.ts` composes collection/delivery                                                 | Extend it; do not build another wizard engine                                    |
| Client support   | Closed IDs in `src/core/types.ts`, fixed `src/adapters/index.ts`; client checks outside adapters | Centralize formats/capabilities; custom paths alone cannot parse unknown formats |
| Sharing          | `skill-sync.ts`, `skill-bundle.ts`, `sync.ts`                                                    | Keep individual bundle links and Hub launchers                                   |
| Repeat import    | `import-plan.ts` skips existing Hub MCP definitions without overwrite                            | Repeat quick is not automatic three-way reconciliation                           |
| Project evidence | `memory-discovery.ts` reads bounded Claude metadata for a selected Git workspace                 | Reuse evidence handling, but it is not a global project/chat catalog             |
| Project identity | `memory-projects.ts` includes path/filesystem data in bindings                                   | Folder moves are not already transparent                                         |
| Notes            | `memory-store.ts` requires structured metadata; native import converts text                      | Native Markdown cannot simply replace the records directory                      |
| Recovery         | `managed-plan.ts`, guarded writes and workflow recovery                                          | Preserve stale-plan/later-edit checks and partial-operation reporting            |
| Chats            | Sessions view in `ui/app/app.js` is a placeholder                                                | Archive/search/families are new functionality                                    |

The earlier review counted 46 CLI guide entries including groups/callbacks, 24 landing command cards and 17 documentation pages per locale. These describe information volume, not proof that a particular module or command is unnecessary. A client registry should remove repeated format knowledge; a smaller file count is not a goal.

## Claude: useful metadata helpers, incomplete archive views

[Session documentation](https://code.claude.com/docs/en/sessions) describes directory/worktree context and relocation. The [SDK session helpers](https://code.claude.com/docs/en/agent-sdk/sessions) provide a useful local listing/read surface. Check language/version parity instead of assuming Python and TypeScript expose identical functions.

Pinned Python SDK source: [`sessions.py`, `3be907edb9c86269d30d1427a77937dd788d6419`](https://github.com/anthropics/claude-agent-sdk-python/blob/3be907edb9c86269d30d1427a77937dd788d6419/src/claude_agent_sdk/_internal/sessions.py).

The lightweight reader uses 64 KiB head/tail buffers. Listings exclude some entries, skip unreadable files and deduplicate native session IDs by modification time. Message reading parses the whole file and builds the visible conversation before applying offset/limit. Thus pagination does not bound file reads, and a friendly session browser is not a lossless archive. Separate enumeration coverage, raw preservation and display filtering. Python's subagent helpers are additional evidence, not a promise of identical TypeScript support.

Dependency cost was checked using npm metadata without installation: `@anthropic-ai/claude-agent-sdk@0.3.318` reports 5,086,044 unpacked bytes; its optional Darwin ARM64 package at the same version reports 319,599,048. This is one platform, not a cross-platform total. Verify with [wrapper package metadata](https://registry.npmjs.org/@anthropic-ai%2fclaude-agent-sdk/0.3.318) and [platform package metadata](https://registry.npmjs.org/@anthropic-ai%2fclaude-agent-sdk-darwin-arm64/0.3.318). Avoid making a large runtime binary mandatory solely to list local metadata. Compare a supported optional SDK adapter with a small versioned reader; assess maintenance and license obligations before reusing upstream code.

## Codex: richer native grouping, explicit coverage required

Pinned protocol version: `d4902cedbf508411f6f8bf049cc5919b4edc24f6`.

- [`thread_data.rs`](https://github.com/openai/codex/blob/d4902cedbf508411f6f8bf049cc5919b4edc24f6/codex-rs/app-server-protocol/src/protocol/v2/thread_data.rs) exposes cwd, parent/fork identifiers, session grouping, Git context, optional project assignment and environment metadata. Preserve these as source-scoped references. An environment label is not connection status.
- [`project.rs`](https://github.com/openai/codex/blob/d4902cedbf508411f6f8bf049cc5919b4edc24f6/codex-rs/app-server-protocol/src/protocol/v2/project.rs) defines native projects with multiple roots. Project APIs/fields are experimental and require capability/version checks. Do not reduce an explicit native grouping to one repository.
- [`thread.rs`](https://github.com/openai/codex/blob/d4902cedbf508411f6f8bf049cc5919b4edc24f6/codex-rs/app-server-protocol/src/protocol/v2/thread.rs) shows listing defaults that can omit archived, noninteractive or attached threads and restrict provider selection. Enumeration needs explicit supported filters and pagination. `use_state_db_only` avoids JSONL metadata repair, illustrating that a list operation can otherwise alter a native cache. Choose and document an appropriate read contract; one default list cannot justify “all chats.” Paginated history may defer item output, so preserve retrieval state before claiming full content coverage.

The [app-server documentation](https://learn.chatgpt.com/docs/app-server) also describes thread/turn/item access and structured tool/file events. Native import/detection capabilities are version-dependent; their availability is not permission to write or a guarantee of cross-client round-tripping.

## DeepSeek Harness: compressed/versioned persistence matters

Pinned implementation: `fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159`.

- [`format.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159/packages/session/session-persistence-jsonl/src/format.ts) defines versioned session headers with optional cwd, parent, subagent origin and preset fields. Formats include plain JSONL and Zstandard; filenames encode generation/format. Preserve unsupported data and report its status instead of assuming every file is readable JSONL. Do not infer ordinary fork lineage from a shared text prefix.
- [`index.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159/packages/session/session-persistence-jsonl/src/index.ts) implements listing/stat/read handles and write-side leases/migration publication. Read mode may prepare migration in memory; write mode can publish it. Default compressed data uses checksummed frames. Reuse a verified read contract or support that framing correctly. Do not open a source in write/repair mode to build the Hub archive. In-process pending sessions need not already exist durably on disk.

The [session abstraction](https://github.com/deepseek-ai/deepseek-harness/blob/fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159/packages/core/session/README.md) permits different persistence backends. A filesystem reader only covers the configured backend it supports; do not boot an entire agent runtime just to discover a few headers without assessing that cost.

## Scope and resource relationships

| Source                                                                                                                                                                                                                                                                                                                 | Design implication                                                                                                       |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| [Claude subagents](https://code.claude.com/docs/en/sub-agents)                                                                                                                                                                                                                                                         | Explicit skill/MCP/memory declarations support dependency inventory; presets and runs remain different objects           |
| [Claude MCP](https://code.claude.com/docs/en/mcp)                                                                                                                                                                                                                                                                      | Respect local/project/user precedence; same endpoint does not imply identical policy or credentials                      |
| [Claude memory](https://code.claude.com/docs/en/memory)                                                                                                                                                                                                                                                                | Custom native directories can simplify sharing where compatible; a shared directory does not prove one-project ownership |
| [Claude skills](https://code.claude.com/docs/en/skills), [Codex skills](https://learn.chatgpt.com/docs/build-skills)                                                                                                                                                                                                   | Preserve bundles, metadata and each client's supported discovery/override rules                                          |
| [Codex instructions](https://learn.chatgpt.com/docs/agent-configuration/agents-md)                                                                                                                                                                                                                                     | Instruction selection depends on location/hierarchy; concatenating every file changes meaning                            |
| [DSH instructions](https://github.com/deepseek-ai/deepseek-harness/blob/fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159/packages/context/agent-instructions/README.md), [DSH skills](https://github.com/deepseek-ai/deepseek-harness/blob/fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159/packages/skill/skill-filesystem/README.md) | Project/global/custom roots and loaded state require native context; found is not necessarily active                     |
| [Git worktree](https://git-scm.com/docs/git-worktree), [rev-parse](https://git-scm.com/docs/git-rev-parse)                                                                                                                                                                                                             | Resolve local repository/worktree/superproject relationships through Git rather than folder-name conventions             |

## Patterns worth borrowing, without adopting their whole systems

[chezmoi's daily workflow](https://www.chezmoi.io/user-guide/daily-operations/) separates source state, preview and apply. Hub can use that familiar sequence while adding collection of client edits; adopting its complete command surface would not simplify Hub.

[Syncthing's synchronization design](https://docs.syncthing.net/users/syncing.html) combines watcher notifications with periodic scans and retains conflict copies. Borrow missed-event recovery and preservation of divergent data. Hub needs scope-aware, user-approved resolution rather than adopting timestamp-based winner selection for structured client settings.

## Storage and read guarantees

- Native JSONL readers should accept complete records only, detect truncation/rotation and retain a generation/revision with the cursor. The last partial record remains pending. Compressed streams require their own contract, not arbitrary byte-offset seeking.
- A read-only API name is insufficient evidence of zero side effects; verify process startup and cache behavior. Do not repair client data as part of discovery.
- [SQLite WAL documentation](https://sqlite.org/wal.html#read_only_databases) explains sidecar/read-only requirements. Copying a live native database's main file alone is not a general consistent-export strategy.
- [SQLite FTS5](https://sqlite.org/fts5.html) offers a possible derived keyword index; it does not supply semantic search or Russian morphology automatically. [`node:sqlite` at Node 22.13](https://nodejs.org/download/release/v22.13.0/docs/api/sqlite.html) was experimental. Select an index implementation after compatibility/performance checks, not by assuming the minimum runtime provides a stable API.

No import throughput, memory ceiling or user completion time was measured in this research. The delivery plan requires benchmarks with fixtures and actual usability checks before making performance or simplicity claims.

## First implementation after the reviewed beta

The working source now provides explicit local Claude metadata discovery through the Projects UI and a capability on the existing adapter boundary. The 29 tests in `tests/project-discovery.test.mjs` exercise the reader, grouping and local HTTP lifecycle with temporary sources, including the follow-up boundary failures in [DISCOVERY_REVIEW.md](DISCOVERY_REVIEW.md). Full checks passed 234 tests; synthetic browser QA covered 112 groups. It does not establish complete archives, native continuation, durable identities, other clients or Windows compatibility. See [the delivery status](DELIVERY.md#first-working-increment-local-claude-project-discovery) and [decided policies](POLICIES.md). The published beta/source tag remains unchanged.
