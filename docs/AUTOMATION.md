# Automatic memory

Agent Hub can import native Markdown notes automatically and ask the active agent to extract durable knowledge from its current conversation. Enable this once for a registered project/client. Subsequent saves use that project policy, source bindings, revision checks, the Hub lock and private recovery backups; they do not require a separate Hub preview for every fact.

## Fast setup

Run `ahub quick` first to prepare the shared Hub without project setup. Then `ahub project connect /path/to/project` previews the selected Git project's memory binding, matched Markdown onboarding, handoff files and lifecycle hooks. Apply the emitted command, restart clients and review native trust/permissions. `--no-automation` omits new policy/hook enablement without disabling existing automation. Project connection does not synchronize global MCP, skills or shared instructions, and does not install a standalone Memory MCP server. See [QUICKSTART.md](QUICKSTART.md).

## What runs automatically

- SessionStart imports changed notes from the selected native directories and supplies a bounded project index plus retrieval guidance.
- UserPromptSubmit begins one checkpoint opportunity for the new user turn.
- Stop imports native changes again, then asks the current agent to perform one semantic checkpoint. The agent sends evidenced facts, or an empty array when nothing durable was learned.
- An optional foreground watcher imports native file changes while no client session is active.

Semantic extraction uses the agent and model already serving the conversation. It adds a continuation/model request before the turn finishes, including when the result is an empty checkpoint. Hub does not start another model, choose a provider, send transcripts to a separate service or require an API key. Native client tool permissions still apply. A hook request is not proof that a model saved anything: inspect pending checkpoints and verify actual client behavior.

This operates on the conversation currently available to the agent. It does not silently ingest every archived session or recover information that has already disappeared from its context. There is no heuristic claim that every sentence in a transcript is a verified fact.

## One-time setup

Initialize Hub and register the checkout first; see [MEMORY.md](MEMORY.md). Run from the Agent Hub source checkout, or substitute your installed `ahub` executable:

```sh
ahub memory auto enable --workspace /path/to/project --client claude-code \
  --native-dir /path/to/that-project/native-memory --dry-run
```

Review and run the exact apply command printed by preview. This enables project autosave, appends owned lifecycle handlers while preserving unrelated hooks/settings, and imports the selected native notes. Repeat for another client with `--client codex` or `--client dsh`. Omit `--native-dir` when that client has no dedicated native Markdown collection; semantic checkpoints still work. Repeating setup preserves earlier clients and sources.

The native directory is an explicit trust/scope choice. Claude stores project notes under its configured project memory directory, which may be overridden by `autoMemoryDirectory` or other client settings. Choose the directory reported by that installation rather than guessing an encoded project name. A client-wide collection containing several projects must not be selected wholesale as one project's native source. Codex's optional native memory and custom DSH profiles may organize data differently; no global-to-project scope is inferred from a filename.

The selected client configuration locations follow existing Hub environment overrides:

| Client      | Hook delivery                                                               |
| ----------- | --------------------------------------------------------------------------- |
| Claude Code | `<CLAUDE_CONFIG_DIR>/settings.json`                                         |
| Codex       | `<CODEX_HOME>/hooks.json`                                                   |
| DSH         | An owned native adapter insert in the selected profile's `cordis.patch.yml` |

Generated commands bind to the selected Hub and runtime executable, not a particular username. Global handlers are project-gated: unregistered projects, disabled policies and clients not enabled for that project return no-op output. Setup never grants permissions, alters the client's trust records or bypasses approval. Restart the affected client to reload hooks. Codex requires reviewing/trusting the exact hooks through its native hook UI; older versions may also need their supported hook feature enabled. DSH loads the bundled `dist/integrations/dsh-memory.js` adapter through its native Cordis profile. It needs no optional Claude hook bridge. Keep the installed Hub package at its reviewed path; moving or removing it requires reviewing setup again. Setup migrates an intact earlier owned bridge declaration, preserving unrelated handlers and plugins. Profile generation alone does not prove activation in a running client.

Existing hook handlers and unrelated settings are retained. A changed, removed, duplicated or unowned Hub handler blocks subsequent setup instead of being silently replaced. Setup and its client configuration changes are recoverable through normal content backups/reset.

## How a checkpoint is saved

The Stop hook requests one bounded extraction pass. It tells the agent to search existing knowledge, use stable fact keys, retain only durable verified project knowledge, attach evidence and exclude temporary progress, speculation, secrets and instructions from untrusted content. Facts always remain in this project; promotion to shared memory is explicit.

With `memory serve --workspace /path/to/project --allow-auto`, the agent can call `memory_checkpoint`. Otherwise the hook supplies the exact `memory auto checkpoint` command and JSON stdin format for the agent's shell tool. The automatic tool is independent of `--allow-write`; a read-only server without `--allow-auto` neither lists nor executes it.

Each checkpoint requires the active project/client/session's random token. Tokens expire after 24 hours and are consumed together with the facts, source bindings and index in one recoverable transaction. They cannot be used in another session or project. A session binds to its first enabled project; switching into another registered project requires a fresh session. SessionStart prunes a bounded batch of expired capability metadata, without removing knowledge records. Empty checkpoints acknowledge completion without inventing knowledge. A manual policy disable immediately prevents new captures, including previously issued tokens.

Hub marks a checkpoint request before telling the agent to continue. Repeated Stop calls cannot issue another request until a new real prompt arrives; hook-generated continuation prompts do not reset the opportunity. This guard does not depend on `stop_hook_active`. The native DSH adapter injects the start context, observes accepted user messages and steers one checkpoint at turn stopping; its own messages never count as new user prompts. Subagent sessions do not create independent checkpoints. An agent that ignores the request leaves a visible pending checkpoint rather than entering an unbounded loop.

## Native notes, duplicates and conflicts

The source directories remain untouched. UTF-8 Markdown topic files and inline knowledge in MEMORY.md are imported; pure local index navigation is omitted and hidden entries are skipped. Existing sources can be discovered and attached through the reviewed onboarding flow in [MEMORY.md](MEMORY.md#discover-and-import-existing-client-memory). Native frontmatter preserves its note title and maps user/feedback kinds to preference/lesson. Plain Markdown can split at second-level headings outside fenced code; empty sections are omitted. Code indentation and internal whitespace are preserved. Symlinks are not followed. Malformed notes are reported as skipped. A scan is bounded to 100 topic files, 2 MiB total, 128 KiB per file, four nested directory levels and 200 sections.

Source/heading bindings give imported facts stable IDs while their body changes. A normal update replaces only an unchanged, previously owned record. Bodies with the same kind and exact content after line-ending and surrounding-blank-line normalization share one canonical fact. Every duplicate retains a read-only source binding, including duplicates of manually maintained facts. A later divergence queues a conflict against that canonical fact instead of silently creating a second contradictory record. Internal whitespace and code indentation are significant. This is deterministic content deduplication, not a guarantee of semantic equivalence between differently worded facts. Renaming a plain Markdown heading changes its source key; old knowledge remains available rather than being silently deleted.

Manual edits or deletions are preserved. A conflicting incoming version goes into a private pending file; automatic processing continues with independent facts. Checkpoint tokens retain the memory revision from the start of the user turn. If another agent changes project memory during that conversation, an attempted replacement with different content is queued rather than overwriting knowledge from a newer view; equivalent content and independent new facts can still be retained. This conservative check may queue an update after an unrelated record changed, so inspect the evidence before resolving it. Deleting a source note does not delete Hub knowledge. Source directories, policies, bindings and non-target records are rechecked before applying.

```sh
ahub memory auto status --workspace /path/to/project --json
ahub memory auto sync --workspace /path/to/project --dry-run
ahub memory auto conflict get auto-<source-id> --workspace /path/to/project
ahub memory auto conflict resolve auto-<source-id> --workspace /path/to/project \
  --take hub --dry-run
# Or preview --take incoming to accept the queued source version.
```

Conflict get explicitly displays both bodies and archived incoming version IDs. Resolve chooses the current Hub value (including a deletion) or the exact queued incoming value, even after automation is disabled. Review the new plan, then apply its exact revision. A changed Hub value or pending queue invalidates the preview. Keeping Hub acknowledges only this source version; a later source change can conflict again. Immutable incoming history remains readable with `conflict get <id> --version <hash>`. Other conflicts remain preserved. Default plan/status output contains metadata and paths, not incoming bodies or checkpoint tokens. Status also probes configured sources and reports missing directories, skipped notes and scan failures without saving their bodies. A fatal source scan error aborts that import batch; retry after correcting the source.

Common private-key/token patterns and credential assignments are skipped before content is retained, including conflict staging. This is a conservative filter, not complete secret detection or proof that extracted knowledge is true. Select appropriate source directories and verify model behavior. The automation policy adds no permissions beyond the operating user and configured client.

## Watching, disabling and recovery

```sh
ahub memory auto watch --workspace /path/to/project --interval 30
ahub memory auto disable --workspace /path/to/project --dry-run
```

The watcher is a foreground process, not an installed OS service. It retries transient sync failures on the next interval, supports SIGINT/SIGTERM and stops when the policy is disabled. It does not run semantic extraction without an active agent. SessionStart/Stop imports work without the watcher.

Automatic callbacks also retry brief lock contention and pre-write stale plans with bounded backoff. Each retry rebuilds the operation against current records. Unknown transaction failures and invalid/consumed tokens are not retried as though they had succeeded.

Disabling preserves knowledge, native notes and hooks needed by other projects. Global handlers become no-ops for this disabled project. Normal `restore <backup-id> --dry-run` rolls back a capture, including the matching index and source binding; edited files block stale restores. Restore and reset revoke all outstanding checkpoint tokens through authority metadata outside the restorable Hub; restored tokens cannot be replayed. Start a new prompt to obtain a fresh checkpoint. Reset archives the current Hub, including private pending conflicts/checkpoint state, before restoring the recorded baseline. See [RECOVERY.md](RECOVERY.md).

The Memory UI shows project automation state, current source issues, queued conflicts and pending checkpoints. Review conflict displays both versions and provides a guarded preview/apply choice. Hook activation, model compliance and permissions still need the real client working trial; protocol fixtures do not simulate the model's judgment.

## Verified integration contracts

- [Claude Code hook events and Stop continuation](https://code.claude.com/docs/en/hooks#stop), and [native memory storage](https://code.claude.com/docs/en/memory#storage-location).
- [Codex hook configuration, trust and lifecycle payloads](https://learn.chatgpt.com/docs/hooks). Local capability inspection used Codex CLI 0.165.0, where hooks are enabled as a stable feature.
- DSH 0.2.1-rc.5 local native Cordis and Session contracts: `agent/created`, accepted `agent/pre-step`, and `agent/turn-stopping`. From the Hub source checkout, run `npm run build` then `node scripts/check-dsh.mjs /absolute/path/to/installed/dsh` to repeat the no-provider compatibility check. It exercises real Cordis dispatch and session message validation with a fixture agent, not a live model conversation. Extraction uses the active agent's context rather than parsing compressed logs.

For a clean package check, build the source checkout and run `node scripts/check-install.mjs`. This packs and installs the actual tarball into a temporary project, then exercises CLI previews/apply, scoped reads, installed adapter resolution and UI asset availability. Dependencies must already be cached for the default offline run; `--online` permits registry downloads. Client directories are isolated and the temporary installation is removed afterward.
