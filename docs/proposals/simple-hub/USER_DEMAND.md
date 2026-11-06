# User problems and the next investment decision

Research and recommendation · 2026-11-06 · reviewed Hub source: `b028c6b`.

[Previous competitive opportunities](OPPORTUNITIES.md) · [Hansard comparison](HANSARD_COMPARISON.md)

**Recommendation: pause new feature development, release the working scope and run a short adoption experiment.** There is evidence of real retrieval, continuity and configuration problems. There is not yet evidence that another broad Hub wins users, retains them or supports a business. Do not implement the proposed project page or general reconciliation engine just to complete the roadmap before testing demand.

This is advice for the maintainer, not an approved product shutdown or an instruction to publish. Research did not submit posts, contact people, change client configuration or release another version.

## How the evidence was gathered

Two independent research passes covered firsthand complaints/workarounds and adjacent tools. A third reviewed current Hansard documentation and launch/search guidance. Sources include vendor forums, GitHub reports and maintainer replies, Reddit, Hacker News and official product documentation. Firecrawl was authenticated but had exhausted credits; web search and page reads were the fallback.

This is a purposive qualitative sample, not a survey or a market census. It establishes that particular people encountered these problems and sometimes spent effort on a workaround. It does not establish prevalence, search volume, market size, willingness to pay or competitor retention. Builder launch posts are supply evidence; their own problem statements are not independent customer validation. Repeated comments by one person are not separate customers.

Competitor features below are documented behavior, not results of installing or benchmarking their current versions. Closed reports are historical evidence, not current defects; an open report also does not prove a defect persists in every current version. Some cached Reddit/HN dates were relative or inconsistent; those cases are marked rather than assigned an invented exact date.

## What people actually struggle with

| Job or problem                                                    | Firsthand evidence and workaround                                                                                                                                                                                                                                                                                                                                                                                                        | What this means for Hub                                                                                                                                                                                                                  |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Find a previous fix, rather than remember a chat's title          | [Cursor users](https://forum.cursor.com/t/allow-smart-searching-through-conversation-history/138941), October 2025–January 2026, wanted to rediscover an endpoint solution. One exported the SQLite history into a text editor to search it.                                                                                                                                                                                             | Readable local capture and full-text retrieval replace observable manual work. Hub already offers these for its three supported clients; this does not establish demand for a new project dashboard.                                     |
| Read history that exists but is absent from a native view         | [Claude Code #27242](https://github.com/anthropics/claude-code/issues/27242), February 20, describes inaccessible pre-compaction content with surviving JSONL. [Codex #30385](https://github.com/openai/codex/issues/30385), June 27, describes missing list/search entries readable by ID.                                                                                                                                              | Independent preservation and exact event references have practical value. These are version-specific reports, not proof all current clients lose history. Hub cannot recover content never saved by a source.                            |
| See the projects where work already happened                      | [Codex #24197](https://github.com/openai/codex/issues/24197), May 23–25, records a CLI user's missing sessions appearing after manually adding the project folder; a maintainer explains the filter. The issue is closed.                                                                                                                                                                                                                | Discovery from recorded working folders is useful when it removes a browsing prerequisite. It does not mean every folder should acquire memory, hooks or write access.                                                                   |
| Continue work after clearing context or changing tools            | [A Claude user](https://www.reddit.com/r/ClaudeCode/comments/1w98t6u/handoff_files_what_did_i_do_wrong/), September 6, reported that a reviewed generated handoff still failed to let the next session continue. A [HN commenter](https://news.ycombinator.com/item?id=49304847) describes repeated use of a small handoff skill; exact date was not reliably extracted.                                                                 | Success is useful continuation in the receiving client, not merely generating a packet. Test Hub against a short Markdown handoff, using the same actual task.                                                                           |
| Carry current decisions without carrying every old assumption     | A [Claude Chat/Code discussion](https://www.reddit.com/r/ClaudeAI/comments/1x6plkx/how_anthropic_still_doesnt_have_context_between/), indexed October 2026 with exact date unverified, describes manual wrapup/resume, rejected approaches and verified-versus-assumed notes. [Beacon's HN discussion](https://news.ycombinator.com/item?id=50182883) includes objections to stale workarounds and a preference for project-owned notes. | An archive is evidence, not automatically current truth. Current files, decisions and source references matter more than claiming complete memory. The laptop-off/cloud part of the first discussion is outside this local-only product. |
| Keep shared settings without damaging independently managed files | [CC Switch #1876](https://github.com/farion1231/cc-switch/issues/1876), April 3, reports sync colliding with Git-owned skills. [Rulesync #3498](https://github.com/dyoshikawa/rulesync/issues/3498), October 16 with maintainer reply October 29, reports concurrent-write loss; the documented workaround avoids simultaneous generation.                                                                                               | Ownership, native-only settings and safe failure are important. Reliable general reconciliation remains costly and unfinished in Hub. These issues justify caution, not a claim that Hub is safer than the current competitors.          |

Additional evidence and important corrections:

- [Cursor title-only search discussion](https://forum.cursor.com/t/search-past-conversations-in-cursor-ai-chat-window/112703), July 2025–February 2026, explains why a conversation title stops describing its later contents. Current Cursor behavior was not tested.
- [Codex #21079](https://github.com/openai/codex/issues/21079), May 4 and now closed, asks for CLI-to-desktop continuity. Its author already reports native onboarding importing Claude Code history. This demonstrates vendor encroachment, not a permanent third-party opportunity.
- [txcript #52](https://github.com/skillsynchq/txcript/issues/52), September 17 and fixed, concerns invisible archived conversations. The author corrected the original cloud/local attribution; the thread demonstrates compatibility complexity, not a presently unfixed advantage for Hub.
- [A long-handoff complaint](https://www.reddit.com/r/ClaudeCode/comments/1uefjj1/context_drastically_exhausts_with_handoffs/), June 24, was corrected by its author to account for different model context windows. It is not causal evidence that handoffs themselves degrade results.
- [CC Switch #2762](https://github.com/farion1231/cc-switch/issues/2762), May 13 and fixed May 18, reports custom skills lost in a symlink-to-copy fallback. Treat the loss as historical user pain and the fix as real progress by the competitor.
- [Rulesync #3607](https://github.com/dyoshikawa/rulesync/issues/3607), October 22, has a same-day Codex metadata fix but a remaining shared-target collision discussion. Different consumers of one folder do not necessarily share semantics.

Not every adjacent complaint is our opportunity. Usage limits cause tool switching but Hub does not add quota. MCP process growth is a real [reported operational problem](https://github.com/openai/codex/issues/11324), but our launcher does not make every client share one server process. Offline machines, cloud-only messages and native runtime state are different problems. Do not expand the roadmap to cover them just because they appear in searches.

## The strongest counterevidence

In the [HN memory discussion](https://news.ycombinator.com/item?id=46426624), users ask for measured improvements and describe Markdown project specifications, decisions and ordinary history search as adequate substitutes. Objections include another service/API key, stale knowledge and native products closing the gap. These are qualitative objections, not proof every memory tool fails.

The [Skillsync launch discussion](https://news.ycombinator.com/item?id=49743049) includes actual user interest and a fixed archived-chat discovery report, but also a user preferring explicit conclusions over moving whole transcripts. It validates several competing workflows rather than one universal need. Skillsync already offers an open session-conversion core. We should not assume context portability is unoccupied.

Several search hits that appear to describe pain are introductions to the author's own product, such as [chat-history](https://www.reddit.com/r/ClaudeCode/comments/1rz9qlx/got_tired_of_digging_through_old_chats_and_losing/), [memgrep](https://www.reddit.com/r/cursor/comments/1uqvbj7/i_made_my_cursor_chat_history_searchable_across/) and [origin](https://www.reddit.com/r/ClaudeAI/comments/1tp9uba/how_do_you_keep_claude_code_from_forgetting_your/). They establish active supply, not independent adoption. No reviewed evidence establishes payment or sustained use for our specific proposition.

## Where Hansard overlaps

Hansard already documents a local archive, search, preserved originals, a background watcher and optional login startup. Its [architecture guide](https://www.hansard.dev/getting-started/how-it-works/) describes one archive used by the app, CLI and agents. Those capabilities are not differentiation for Hub.

Its [continuation guide](https://www.hansard.dev/guides/continue/) documents a new conversation seeded with bounded context, plus separate same-client resume/fork support. Its [memory guide](https://www.hansard.dev/guides/memories/) covers cross-agent retrieval, revision history, approved native-memory editing and unification. Our context packet is useful but is not a new product category.

The [project guide](https://www.hansard.dev/guides/projects/) already provides repository/folder conversation groups and project memories alongside coordination. A project page is a sensible way to organize our UI, not a standalone reason to continue investing.

Hansard's [skills/MCP guide](https://www.hansard.dev/guides/skills-and-mcps/) documents cross-agent inventory and sharing through its tools/skill bridge, with permissions and per-conversation controls. Hub's native configuration/link delivery has a different workflow; that difference needs a task comparison, not an assumption of superiority.

The maintainer's preference for a smaller interface is a valid product hypothesis. This research did not establish a substantial independent group complaining that Hansard is too complex. A broad menu does not by itself prove poor usability, and a shorter menu does not prove lower effort to complete a task.

## Other substitutes narrow the proposed advantage

| Product                                                                        | Relevant documented behavior                                                                                                              | Implication                                                                                        |
| ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| [CC Switch](https://github.com/farion1231/cc-switch)                           | MCP/skills/prompts management, project profiles, session browsing/search/resume and configuration backups.                                | Another broad manager already combines configuration and sessions.                                 |
| [Rulesync](https://rulesync.dyoshikawa.com/reference/cli-commands.html)        | Import/convert/generate shared instructions and settings into native files; doctor and dry-run/check workflows.                           | Canonical rules and native output are established approaches.                                      |
| [Universal MCP Sync](https://github.com/nawodyaishan/universal-mcp-sync)       | Native configurations without an always-on gateway; discovery, doctor, exact previews, saved plans, stale checks, redaction and recovery. | Safety and native-client operation are expectations already offered elsewhere, not unique slogans. |
| [Agent Deck](https://github.com/asheshgoplani/agent-deck)                      | Multiple native sessions, grouping/worktrees, search/resume, scoped MCP controls and skills.                                              | Session management is also occupied, though it asks users to adopt a manager.                      |
| [Claude Session Handoff](https://github.com/fvhreimert/claude-session-handoff) | A small skill discovers Claude transcripts and prepares context for Codex.                                                                | A much smaller installation can substitute for our handoff feature alone.                          |

These are official claims, not benchmarked reliability results. Their existence defeats uniqueness claims; it does not prove they are better for every target user. Licensing, stars and feature counts do not establish a business outcome.

## A position worth testing

Target developers who already use at least two supported native clients, have existing project data, and recently lost time retrieving prior work or repeating a handoff. A person happy with one client and one project Markdown file is a poor initial target.

Candidate promise: **Find a previous decision and take its context into your next coding client, while keeping your existing workflow.** Shared settings and recovery support that promise; they need not all compete for the headline.

The possible advantage is less effort and fewer mistakes in that complete job. It is not local-first, open source, a project card, MCP, automatic capture or a bounded handoff in isolation. Measure it against Hansard and the person's actual Markdown/Git/script workaround. Do not advertise superiority before such a comparison.

## Continue, release or stop?

| Choice                                                                             | Recommendation now                               | Reason                                                                                                                                                 |
| ---------------------------------------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Continue the broad implementation roadmap                                          | No                                               | No independent adoption evidence yet; major capabilities already overlap other tools and native clients.                                               |
| Add one more project page before seeking users                                     | Defer                                            | It may help usability, but the existing archive/search/handoff is enough to test the central promise.                                                  |
| Freeze features, package the current working version and launch a small experiment | Yes                                              | The next uncertainty is who returns to use it, rather than whether another feature can be implemented.                                                 |
| Publish, then immediately abandon all follow-up                                    | Only if the goal is a personal/portfolio utility | This is legitimate, but it will not test recurring product value. A demand experiment needs a short period of support and observation.                 |
| Stop permanently today                                                             | Not required by this evidence                    | Competition alone does not show there is no segment. One bounded experiment can inform the decision at much lower cost than further broad development. |

Existing code and tests are sunk effort, not a reason to keep building. The relevant comparison is future time spent on Hub versus another project. If the maintainer does not want to recruit testers or support a small launch, publishing an honest personal utility and ending expansion now is reasonable.

## A bounded launch and decision plan

Treat the following numbers as proposed operating limits, not industry benchmarks or research findings.

1. **Cap launch preparation at a few days.** Align the downloadable release with the currently advertised source features; the published beta archive is older than `b028c6b`. Verify installation/update/removal in an isolated profile, make one short real demo and fix only blockers that stop the core tasks. No new dashboard or broad sync engine first.
2. **Recruit five to ten independent users who already alternate supported clients.** Ask about their last concrete failure and observe their present workaround before showing Hub. Use their chosen data; avoid treating friends' encouragement as adoption.
3. **Give the current product two real jobs.** Find a previous decision/solution, then continue a task in another client with enough correct context. Ask users to run one real shared-settings preview if that is their primary pain. Compare setup effort, successful task completion and mistakes against the workaround. A packet being generated is not successful continuation.
4. **Observe for two weeks.** Fix installation/data-loss bugs, answer questions and record voluntary feedback. No transcript telemetry is needed to run a small manual study. Track people who reached a useful task separately from those who could not install. Stars, downloads, page views and launch votes are not return use.
5. **Choose once.** A reasonable small-team gate is at least five activated testers, three returning on separate days without reminders, and a repeated task they can say Hub replaces. Continue only that demonstrated job. If activated users do not return after blockers are addressed, retain an open-source personal utility or maintenance-only mode and move on. If recruitment fails, demand remains unknown; do not call a quiet HN post proof of no market, and do not let the uncertainty justify endless development.

If paid product value is the goal, return use is necessary but insufficient: separately test a real paid offer and its support cost before planning a business. This research did not find evidence to set a price.

## SEO, Hacker News and Product Hunt

Use distribution to find users for the experiment, not to postpone it. Prioritizing HN and relevant native-client communities over a large Product Hunt campaign is a recommendation based on this developer audience, not measured channel conversion.

For Show HN, lead with the runnable tool and a concrete demo. [HN's guidelines](https://news.ycombinator.com/showhn.html) say it must be something people can try, with low barriers; a landing page alone is not a Show HN. Be present for questions. Do not ask for votes.

Product Hunt is an optional second channel. Its [launch guidance](https://help.producthunt.com/en/articles/17350772-launch-guide) emphasizes a working product, a clear edge and feedback after launch. Allocate a small fixed preparation budget; a ranking is not a recurring-use metric. No submissions or outreach were performed in this review.

Create at most a few useful pages answering actual supported tasks:

- Search and export local Claude Code/Codex chat history.
- Share an MCP definition between Claude Code and Codex, with a real preview and recovery example.
- Continue a Claude Code task in Codex using inspected excerpts and original references.
- Optionally compare Agent Hub and Hansard fairly, dated and explicit about scope.

These are content ideas, not measured keywords. Use tested steps, screenshots, native/manual alternatives and current limitations. Do not promise exact native-session migration or automatic synchronization of every data type. The [Google content guidance](https://developers.google.com/search/docs/fundamentals/creating-helpful-content) favors useful original work; its [spam policy](https://developers.google.com/search/docs/essentials/spam-policies) rejects scaled pages made primarily to manipulate ranking. Do not build an SEO content factory or wait for search ranking before recruiting direct testers.

## What remains unknown

- Independent users' installation success, repeated use and replacement of an existing tool.
- Whether Hub is measurably simpler than Hansard for the same actual task.
- Whether search/handoff or shared-settings management is the strongest initial reason to install.
- Current competitor runtime behavior, comparative performance, paid demand and support economics.
- Search volume and channel conversion. Public complaints cannot supply those numbers.

The implementation remains paused. The incomplete project-context draft is kept outside runtime source. No new feature is needed to learn these things first.
