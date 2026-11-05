# Historical research: alternatives and product direction

These notes summarize research collected on 2026-11-02. They are product-planning context, not a current feature comparison or a recommendation to install another tool. Repository capabilities, activity and popularity were not revalidated for this documentation update. The current Agent Hub contract is described in [Quick start](QUICKSTART.md) and [Design](DESIGN.md).

## Problems explored

The original research looked at several separate needs: sharing MCP definitions, distributing complete skills, keeping instructions consistent, carrying task state between agents, retaining useful knowledge, and searching old conversations. These needs overlap, but a tool that addresses one does not necessarily solve the others.

Agent Hub's direction is a local canonical store with reviewed client projections, visible conflicts, private credential references, and recoverable writes. Quick setup reduces the number of steps required to reach that result. It does not claim automatic interoperability with every native memory format or archived session.

## Projects considered

| Area                           | Examples in the original research                                                                                                                                                                                                                                      | Questions to investigate                                                                                               |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Configuration and rules        | [Ruler](https://github.com/intellectronica/ruler), [ai-config-sync-manager](https://github.com/slash9494/ai-config-sync-manager), [agent-rules-sync](https://github.com/dhruv-anand-aintech/agent-rules-sync), [ai-rules-sync](https://github.com/lbb00/ai-rules-sync) | Is the authority global or project-local? How are conflicts, external edits and credentials handled?                   |
| Skill distribution             | [skills](https://github.com/vercel-labs/skills), [manage-skills](https://github.com/Getty/manage-skills)                                                                                                                                                               | Can existing bundles and their assets be reused without adding another installer?                                      |
| MCP management and aggregation | [mcp-fleet](https://github.com/AZERDSQ131/mcpm), [1MCP](https://github.com/1mcp-app/agent)                                                                                                                                                                             | Should clients receive separate launch definitions or one proxy endpoint? What happens when that proxy is unavailable? |
| Agent handoff                  | [context-relay](https://github.com/krika2810/context-relay), [handoff](https://github.com/zaki2993/handoff)                                                                                                                                                            | How can explicit task notes complement, rather than depend on, transcript extraction?                                  |
| Memory                         | Basic Memory, Memorix, mcp-memory-service, [shared-agent-memory](https://github.com/dan-calin/shared-agent-memory)                                                                                                                                                     | Which interchange formats preserve source identity, atomic knowledge and relationships?                                |
| Conversation search            | [claude-history](https://github.com/raine/claude-history)                                                                                                                                                                                                              | Can existing parsers be reused before building a separate archive index?                                               |

These are research leads. The table does not assert that a project currently supports or lacks a feature.

## Product decisions

1. Reuse local skill bundles and established instruction files. Do not compete with every package installer.
2. Keep MCP credentials in the private Hub environment and refer to variables from the canonical registry.
3. Treat the Hub as authoritative after import. Surface later client differences for a reviewed decision instead of choosing the newest file automatically.
4. Keep project handoff notes explicit: PROJECT.md for durable context and NOW.md for current work. Initialization must not invent architecture or completed checks.
5. Use one memory service for CLI, UI and optional MCP access. Import supported native Markdown without relocating its source. Treat structured graph interchange as separate work.
6. Make the first useful result easy to reach through quick setup, while retaining individual commands for detailed review.

## Risks and open questions

Client formats and hook APIs can change. Adapter fixtures and a real working trial remain necessary. Native client features may reduce the need for a separate Hub; the product must remain useful through clear ownership, safe synchronization and a coherent workflow.

Popularity counts and a few forum threads do not establish product demand. The original research had gaps: inaccessible Reddit discussions, incomplete reviews of several memory systems, unverified third-party popularity figures and no systematic package-download analysis. Those gaps remain research tasks, not release evidence.

Archived-session ingestion, cross-machine configuration policy and structured memory interchange should be driven by concrete user cases and their recovery boundaries. See the [current opportunity review](proposals/simple-hub/OPPORTUNITIES.md) for product priorities and [Design](DESIGN.md) for implemented versus planned behavior.
