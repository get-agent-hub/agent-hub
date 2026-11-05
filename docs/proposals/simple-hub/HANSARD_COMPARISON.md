# Hansard and Agent Hub

2026-11-05 · [simplification plan](README.md)

Hansard is a direct competitor across much of the proposed Hub. It would be inaccurate to position it as only a chat viewer: its documented product also covers memories, cross-agent tools, skills and orchestration. Our current implementation is much narrower, especially around conversation history.

## What was checked

Read the official site, feature/reference documentation and release notes. Inspected the published `hansard@0.7.1` manifest, license and selected project-identity, plugin-bridge and DSH importer source files. Downloaded its public npm archive with lifecycle scripts disabled; did not install it, run its code, import personal data or benchmark its app. Documentation may be ahead of a release; listed Hansard capabilities below are documented claims unless explicitly described as source observations.

The [release page](https://www.hansard.dev/releases/) and npm metadata identify 0.7.1. The [published manifest](https://registry.npmjs.org/hansard/0.7.1) declares MIT, Node `^20.19.0 || >=22.12.0` and native/storage dependencies including `node-pty`, `better-sqlite3` and `classic-level`, plus `stream-json`. The archive contains readable JavaScript source. Its manifest does not declare a repository URL; that is not evidence of closed source. A public contribution repository was not established in this review.

## Capability comparison

Agent Hub entries describe the reviewed beta plus the current validated local discovery work; these local changes and planned features are not counted as a published release.

| User need                                   | Hansard, according to its documentation                                               | Agent Hub today                                                                                 |
| ------------------------------------------- | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Preserve conversations from several clients | Local normalized archive and preserved source files; archive survives native deletion | Initial Claude project/session metadata only; no conversation archive                           |
| Retrieve another agent's past work          | Archive search and recall integrations                                                | Scoped knowledge MCP; archived-conversation recall still planned                                |
| Share tools and skills                      | Inventory plus a Hansard MCP bridge                                                   | Canonical skill bundles with native links; portable MCP definitions and native launcher entries |
| Collect and edit memory                     | Revision archive and edits to supported original memory files                         | Structured project/shared records, selected native imports and guarded changes                  |
| Find projects and relationships             | Project navigation and evidence-backed graph                                          | Initial cwd/Git/worktree grouping; durable catalog and broader relationships planned            |
| Continue work in another client             | New conversation with a prepared context summary; native resume is separate           | Repository handoff files; no native chat continuation                                           |
| Work across machines or teams               | Optional Personal Sync and Teams                                                      | Local client connections; no multi-device replication                                           |
| Install and run                             | Published npm CLI and desktop downloads                                               | GitHub source/package beta; global installation from reviewed source/tarball                    |

Hansard's archive pipeline keeps originals, normalized conversations and derived indexes distinct. Its watcher refreshes the archive; deleted native history remains preserved. This overlaps our archive design closely. [How it works](https://www.hansard.dev/getting-started/how-it-works/).

Its memory guide describes revision backups, editing supported native files, and a reviewed unification workflow. Retrieval can search across providers/projects unless narrowed. Our project-bound memory MCP is a concrete current scope choice, not proof that Hansard lacks access controls elsewhere. [Memories](https://www.hansard.dev/guides/memories/).

The graph distinguishes recorded relationships from inferred similarity and exposes evidence. Our chat→project, family and provenance ideas are useful, but not unique product differentiators. We can expose those relationships through ordinary project pages without building a graph interface first. [Graph](https://www.hansard.dev/guides/graph/).

## The important architectural distinction

Hansard's main advertised sharing route lets a conversation reach another client's installed tools through Hansard's MCP entry; skills are supplied through its skill tool. It also supports keeping plugin copies for project environments, so it is not accurate to say it never owns shared content. [Skills and MCP](https://www.hansard.dev/guides/skills-and-mcps/).

Agent Hub's existing route collects portable definitions into Hub, links complete skills and renders supported native configurations. This can appeal to users who want their existing clients to keep working through native files and a small shared configuration layer. However, our MCP entries still launch Hub processes; this is not a runtime-free approach. A lighter or more reliable experience remains a hypothesis to measure, not an established advantage.

Most importantly, automatic all-content reconciliation of external edits is still unfinished in Agent Hub. That prospective behavior cannot be used as a current competitive claim. We already have guarded writes, scopes and setup recovery; the proposed general reconciliation engine is the next implementation work.

## Limits that matter in a fair comparison

- **Import is not full integration.** Hansard's matrix distinguishes history import, memory capture, managed tool setup and runtime launch. DSH history is supported, while its matrix does not claim a managed DSH tool integration. Our DSH MCP/settings integration is implemented, while DSH conversation ingestion is not. [Provider support](https://www.hansard.dev/reference/provider-support/).
- **Cross-client continuation is contextual handoff.** Hansard documents a new conversation with a summary of up to 24 KiB; hidden context, credentials and running processes do not transfer. Native same-client resume/fork has a separate support matrix. This supports keeping those concepts separate in our own interface. [Continue](https://www.hansard.dev/guides/continue/).
- **Raw preservation has a different privacy boundary from redacted views.** Hansard documents local archive operations and optional outgoing features; preserved originals can retain secrets even when visible/indexed text is redacted. Model-backed features may send selected context to the chosen provider. We should explain our eventual archive boundaries equally concretely. [Data boundaries](https://www.hansard.dev/privacy/data-boundaries/).
- **DSH support requires real format handling.** Its guide covers versioned logs, Zstandard, preserved generations and custom-backend limits. This is a useful compatibility reference, not a reason to claim every DSH deployment is supported by either product. [DSH import](https://www.hansard.dev/imports/deepseek-harness/).

One limited code observation: the published package's `src/plugin-bridge/process.js` worker refuses non-stdio servers in its launch function. This does not establish that every Hansard tool path lacks remote transport. Our HTTP/SSE launch paths already exist, so a controlled remote-MCP comparison would be valuable before making any transport advantage claim. No such end-to-end comparison was run.

The published npm payload reports about 44.4 MB unpacked; the reviewed Agent Hub package was about 1.47 MB. These exclude installed dependencies and optional models and do not measure memory, CPU, startup time or usability. Hansard has a substantially broader scope, so payload size alone does not establish a better architecture. [Package metadata](https://registry.npmjs.org/hansard/0.7.1).

## Product recommendation to validate

Competing with Hansard by copying its complete feature list would conflict with the requested minimal product. Our next test should be whether Hub delivers a simpler configuration and knowledge workflow for users who already use native clients:

1. Find supported clients and existing content.
2. Review one concise collection/connection plan.
3. Share tools, skills and project knowledge while preserving client-specific settings.
4. Reconcile later edits and resolve genuine differences.
5. Disconnect or recover with a clear result.

This is a candidate focus, not an established unique selling point. Local storage, MIT licensing, shared skills/MCP and a common memory archive are already offered elsewhere. We need an unassisted task comparison and reliable external-edit reconciliation before advertising superior simplicity.

Keep the current discovery fixes first. Do not expand into account routing, agent orchestration, team collaboration, phone access or graph UI merely because Hansard offers them. These can remain outside the near-term product without compromising the original Hub workflow.

For conversation history, evaluate two explicit options after that workflow works: our own minimal archive, or an optional adapter that retrieves an existing archive such as Hansard through supported interfaces. The latter could reduce duplicated work, but must preserve project access policy, version compatibility and source identity. It must not become a mandatory dependency or silently change who owns canonical data. Avoid bridging generated tool entries back into themselves.

No roadmap pivot, dependency adoption or runtime integration is made by this research. The next decision should be based on the user's actual workflow and a controlled trial, rather than feature-count competition.
