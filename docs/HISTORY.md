# Chats, projects and history

Agent Hub keeps a local archive of supported native conversations. Clients continue owning their active sessions. Hub preserves the source bytes, displays their events, groups projects and lets connected clients search an explicitly granted part of the archive.

## Start in the interface

Run `ahub ui`. The interface starts a read-only project metadata scan over known Claude Code, Codex and DSH stores. Finding a working folder does not register project memory or grant another client access.

Open **All data → Chats**, choose native sources and click **Capture selected history**. This copies supported history into private Hub storage. Messages may contain private text, tool output and embedded images; nothing is uploaded. Progress and source coverage remain visible. Stop retains conversations already committed. Reloading the page reconnects to the running job; restarting the server retains the saved archive.

Use the search field to search conversation text and tool data. Select All events to include technical context and other native fields. Filter by client or project. Open a conversation to read event windows, inspect every original JSON field, choose an earlier preserved version or download the source bytes. Long messages have a complete original-event reader rather than a silently truncated preview.

Chat names use native titles when available, otherwise the first substantive user request. Claude terminal notices, Codex environment/instruction envelopes and brief greetings do not become derived titles; pasted-content wrappers are omitted from title excerpts. DSH metadata marked as a fallback excerpt cannot override a full task, provider title or delegated-task label. Known approval-history and build-output prompts get concise descriptive labels; long request excerpts end with an ellipsis at a word boundary. Older technical titles are corrected from preserved events at read time, without reimport or catalog writes. The list shows human client/project labels; event counts, coverage and revisions are in conversation details. Incomplete archives remain visibly marked. Explicit native names are preserved. If a title cannot be checked because its derived index is unavailable, that row stays listed with a review warning; opening unreadable event data still reports the error. A read never silently repairs or rebuilds archive files.

The interface defaults to **Conversation**: readable user/assistant messages with reasoning and tool data in expandable sections. Runtime context and technical lifecycle events remain available through **Show → All events**, which also includes them in search. DSH's nested message envelopes are decoded for display; transport copies of the same tool call are not repeated. Previously captured generic indexes are interpreted again when read, so this display correction needs no reimport and does not rewrite source bytes or grants. Existing CLI/MCP event windows retain their all-events default.

**Projects** shows saved associations with chat links. Rename a project or exclude it without changing native files. Explicit aliases can associate a relocated directory with an existing project through the advanced policy interface. Git common-directory evidence groups worktrees; clones are not merged by name or remote URL. A chat can have several related projects. Saved associations remain separate from the existing project-memory registry.

Expand **Access & project settings** and choose **Connect clients…** on a saved project to preview a read-only history MCP connection. The review identifies clients and configuration files. Apply adds its scoped grant and Hub tool definition, then uses the existing guarded MCP delivery. Other definitions and native settings are preserved. Client restart and native trust approval may be required. Partial delivery has per-client results and recorded recovery; it is not a simultaneous filesystem transaction. **Revoke access…** stops retrieval immediately while retaining the archive and installed configuration entry.

Enable **Keep updated** to rescan selected sources every 30 seconds while the Chats or Projects page stays open. An update running on the server continues across page reload. Closing the page does not install a background service. For refresh independently of the browser, use the foreground watcher below.

## Terminal workflow

```sh
ahub history scan
ahub history status
ahub history ls --limit 50
ahub history search "a phrase from a past conversation"
ahub history show CHAT_ID --offset 0 --limit 50
ahub history event CHAT_ID EVENT_NUMBER --offset 0
ahub history watch
```

These commands output JSON. `show` returns `next` for another event window. `event` returns `next` for another character window of the complete native JSON record. Search returns event references and bounded snippets; it searches complete indexed records, not just visible previews. `show --revision HASH` reads a preserved earlier version.

`scan --client claude-code`, `--client codex` or `--client dsh` restricts capture. `--client ID --root /absolute/native/store` explicitly selects an additional supported store. For Claude, the root contains project collections; for Codex, it contains `sessions` and `archived_sessions`; for DSH, it contains project/session directories. The browser accepts declared source IDs, never arbitrary paths.

To connect one saved project from the terminal:

```sh
ahub history connect PROJECT_ID --client claude-code,codex,dsh
ahub history connect PROJECT_ID --client claude-code,codex,dsh --apply --expect REVIEWED_REVISION
```

The preview does not write. Apply requires that exact current revision. The result includes per-client delivery and workflow recovery. `ahub history serve --grant CONNECTION_ID` is the stdio MCP entry point used by the generated definition; ordinary users do not need to run a server manually.

## Supported source scope

| Source      | Read scope                                                                                                                                   |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Claude Code | Project JSONL files and nested subagent logs in `CLAUDE_CONFIG_DIR/projects`                                                                 |
| Codex       | JSONL rollouts under `CODEX_HOME/sessions` and `archived_sessions`, without app-server startup or database repair                            |
| DSH         | Latest canonical JSONL generation per session, plain or checksummed Zstandard; default known root and literal roots in local profile patches |

Readers preserve every captured byte and complete JSON record in the supported files, including stored user/assistant/tool/system/context events, explicit lineage and unknown fields. They do not infer missing parent relationships. Native format migrations are not executed. Historical DSH payloads remain original events, without claiming native migration semantics; newer formats or undecodable frames are explicitly unsupported for interpretation. An incomplete final record/frame is preserved as pending and retried on the next scan.

DSH can use custom plugins, roots expressed by runtime templates or a non-filesystem backend. These are not resolved by executing configuration. Select an explicit supported root when needed. Native cloud, encrypted and deleted data, in-process sessions not yet persisted, undocumented remote-environment mapping and native multi-root project APIs are not reconstructed from guessed schemas. Source coverage refers to the selected supported stores, not every conversation the user has ever had.

Capture detects supported appends, atomic replacements, truncations and same-sized rewrites. Unchanged file stamps avoid unnecessary capture; changed files are checked in full so earlier edits are not mistaken for append-only changes. Shared content-addressed blocks reuse unchanged prefixes across revisions. A scan stopped halfway resumes by retaining committed units and idempotently checking the remaining source on the next run; it does not have a durable mid-file cursor.

Individual indexed records are limited to 16 MiB and compressed frames to a 64 MiB decode/window capacity. Exceeding interpretation limits never silently discards source bytes: raw history remains preserved and coverage becomes incomplete. File reads and UI cancellation are cooperative; a filesystem operation or synchronous frame decode is not a hard real-time deadline.

## Attachments and original content

Embedded content remains in original records. Explicit local attachment/deferred-file references inside the selected source store are copied when accessible. Separate assets are downloadable from their chat. Remote references are not fetched. Missing references and paths outside the permitted source root remain visibly incomplete; arbitrary paths found in chat text do not authorize reading project files or credentials. Additional external attachment-root grants are not currently supported.

A complete event archive and complete attachment coverage are different results. Raw files may contain private values even though public configuration plans and operational errors remain redacted. Downloads intentionally return the selected original data.

## Access and removal

The local interface and CLI are the machine owner's operator tools. Native MCP clients receive a separately persisted project/source grant. The same current grant filters list, search, snippets, direct IDs and original-event windows. A chat associated with several projects requires all of them in the grant; a related-project link cannot widen access. Revocation and exclusions are rechecked after asynchronous retrieval. A replaced source directory is blocked rather than silently inheriting its previous binding.

History MCP exposes `history_list`, `history_search`, `history_read` and `history_event`. It does not execute archived instructions, edit native sessions or expose an archive-wide default grant. A memory-project disconnection also revokes associated history grants. Scope checks do not isolate an application that already has independent filesystem permission to read Hub storage.

Advanced policies use a small local JSON file:

```json
{ "operation": "exclude", "id": "SOURCE_OR_PROJECT_ID", "excluded": true }
```

```sh
ahub history policy change.json
ahub history policy change.json --apply --expect REVIEWED_REVISION
```

Supported policies are `exclude` (`id`, `excluded`), `forget` (`id`), `label` (`id`, `label`), `alias` (`id`, absolute `directory`), `grant` (`id`, `projects`, `sources`) and `revoke` (`id`). `status` lists IDs. Broadening grants is an explicit reviewed operation. Exclusion hides existing content from retrieval and stops future capture for that source/project; inclusion can be restored. It does not delete the archive.

`forget` removes one conversation's archive units, collects unreferenced blocks and records a persistent deletion marker so a later scan does not reimport it. Native originals and older recovery archives are retained. If file removal fails, the result reports retained files while the content stays hidden. No secure-erasure claim is made. Source disappearance alone never deletes captured history. Automatic eviction and tombstone expiration are off.

## Storage and recovery

The archive lives under `state/history` inside the Hub, excluded from normal Hub Git history. Data and blocks use private file permissions. Catalog and descriptor formats are versioned; unknown catalog versions are refused. Complete raw/event units precede catalog acknowledgement. Cancellation or a failed unit retains the previous acknowledged version. Interrupted staging and unreferenced blocks may remain private on disk; subsequent capture is idempotent.

`ahub history rebuild` verifies preserved raw blocks and rebuilds current derived event indexes without reading native clients or contacting a model. A corrupted raw block is refused rather than used to produce a new index. Catalog corruption is a separate recovery problem: preserve the files and restore a compatible catalog from recovery; rebuild does not invent project corrections or grants.

Existing first-baseline reset and recorded connection-workflow recovery still apply. Reset archives current managed state before restoration and may restore retained older history/policy. Review [recovery semantics](RECOVERY.md) before applying it. Neither resetting Hub nor uninstalling its CLI erases native conversations.

Cross-client interoperability here means shared archive retrieval through MCP. Native continuation, rewriting active session stores, multi-device replication and general all-area reconciliation are separate capabilities; they are not implied by successful archive capture.
