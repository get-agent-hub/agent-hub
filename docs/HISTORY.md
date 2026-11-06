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

Enable **Update selected sources in the background** to check your selection every 30 seconds. One local worker continues after you close the browser, terminal or Hub UI server. Reopening the interface shows its current state, last complete update and source coverage. The source list also separates the most recent check from the last complete read. Turn the switch off before changing the selection; stopping retains checked work and every saved version. A stop request remains active if filesystem work takes longer than the interface can wait.

The worker reads only the selected store paths. Newly discovered profiles are not added to that selection. It retries temporary source/storage/lock failures, keeps old chats when originals disappear, and refuses a different directory at a previously bound path. Exclusions, deletion markers and scoped client grants still apply. It does not deliver MCP/skills/instructions or import project memory; those use their existing workflows. Background capture changes the Hub archive, never native conversations.

Background refresh starts a detached process. To resume automatically, choose **Resume selected updates when I sign in**. Review the listed user-level startup files and apply. macOS uses a LaunchAgent; Linux uses a systemd user service and its `default.target.wants` link. No system service, administrator access, login credentials or shell startup changes are involved. Setup and removal use the existing checked file/recovery workflow and preserve foreign or edited files. Turning off login startup changes the next session start; use the background switch to stop the current capture.

Login startup reads the saved selection and enabled policy. A stopped policy, missing/replaced Hub or invalid stop metadata never resumes capture. New profiles are not discovered into the selection. Keep the reviewed Node/package path available; moving or removing it requires reviewing startup again. On Linux this requires systemd user sessions; the job starts with the user manager, so a manager kept alive across logins may need a restart before the new setup takes effect. Setup does not reload/restart your current user manager. File installation, actual worker activity and a real post-login trial are separate evidence.

Without login startup, turn background refresh on again after a restart. There is no automatic crash supervisor. A hard crash during a Hub mutation may leave an operation lock; inspect it through the existing recovery workflow before resuming. No stored PID is ever killed to stop or recover an updater. Missing/invalid policy or a replaced Hub directory stops the worker rather than discovering a new scope or recreating reset data. The operating system may request its normal filesystem access permissions; Hub does not change those permissions.

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

`watch` without flags stays in the foreground. To continue refreshing the sources already captured in this Hub after closing the terminal:

```sh
ahub history watch --background
ahub history status
ahub history watch --stop
```

The background form uses the saved source paths, including explicit custom roots, and omits excluded sources. It requires at least one saved source. It does not discover new profiles each pass. `--interval 5` through `--interval 300` changes the check interval when starting; the interface uses 30 seconds. `status.background` reports whether a worker is actually running, not just whether an earlier configuration enabled it. Repeating the same start is idempotent. `--stop` retains the selection and archived chats.

Login startup can also be reviewed from the terminal:

```sh
ahub history watch --login on
ahub history watch --login on --apply --expect REVIEWED_REVISION
ahub history watch --login off
```

Use the emitted apply command to remove startup after reviewing the `off` preview. These changes take effect at the next user-session start. `status.startup` describes owned file installation, not native activation. The generated macOS/Linux configuration follows [Apple's LaunchAgent model](https://developer.apple.com/library/archive/documentation/MacOSX/Conceptual/BPSystemStartup/Chapters/CreatingLaunchdJobs.html) and the [systemd service contract](https://www.freedesktop.org/software/systemd/man/latest/systemd.service.html).

## Continue in another client

Open a saved conversation and choose **Continue in…**. Select Claude Code, Codex or DeepSeek Harness. Optionally describe the next step, then choose **Prepare context**. Review the displayed original-message excerpts and source references. **Copy context** or **Download context**, open a new conversation in the target client and paste it there.

The packet includes the first substantive request found in the inspected windows and up to ten recent user/assistant text events, their native ordinals/timestamps, preserved revision, project labels and recorded working locations. It instructs the receiving agent to verify current files, tests, decisions and remaining work using its normal project instructions, memory and handoff notes. Hub does not invent those decisions or claim that a proposed tool call completed. Tools, reasoning and runtime instructions are omitted from this compact packet; full events remain in the archive.

This is a deterministic context packet, not a model-generated summary. Hub makes no separate AI/provider request, starts no client and writes no native conversation or project file. It does not grant the target client archive access. If that client has a suitable History MCP connection, it can follow the pinned references; otherwise the copied excerpts and local operator/event commands still work. Review private text before sharing it with another client or provider. Current access/exclusions are checked again before the interface copies/downloads context. A copied packet cannot be recalled later by revoking a grant.

For large chats, preparation inspects at most the first 1 MiB and last 4 MiB of saved event data, verifying the blocks it reads. Partial boundary records and omitted middle events are explicitly reported. Excerpts are capped at 2,000 characters each; incomplete event/attachment coverage remains visible. This saves prompt space without pretending the packet contains the full conversation. Historical directories are references, not proof of an available current checkout.

```sh
ahub history handoff CHAT_ID --client codex
ahub history handoff CHAT_ID --client dsh --revision PRESERVED_HASH --next "Review the pending changes"
```

Terminal output is JSON containing the packet text, references, coverage notes and digest. Preparing it is read-only and works after native originals disappear as long as the selected preserved data is intact.

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

The running Hub server reuses a bounded in-memory cache of derived chat titles and dates. It still checks the current catalog, access and saved index identity on each list request. New captured revisions and rebuilt indexes invalidate those summaries. Opening a chat or downloading its source still reads the preserved data. The first sorted list after a server restart must inspect saved event prefixes; later lists can reuse their summaries. The cache creates no files and is not a substitute for archive storage.

The archive lives under `state/history` inside the Hub, excluded from normal Hub Git history. Data and blocks use private file permissions. Catalog and descriptor formats are versioned; unknown catalog versions are refused. Complete raw/event units precede catalog acknowledgement. Cancellation or a failed unit retains the previous acknowledged version. Interrupted staging and unreferenced blocks may remain private on disk; subsequent capture is idempotent.

`ahub history rebuild` verifies preserved raw blocks and rebuilds current derived event indexes without reading native clients or contacting a model. A corrupted raw block is refused rather than used to produce a new index. Catalog corruption is a separate recovery problem: preserve the files and restore a compatible catalog from recovery; rebuild does not invent project corrections or grants.

Existing first-baseline reset and recorded connection-workflow recovery still apply. Reset archives current managed state before restoration and may restore retained older history/policy. Review [recovery semantics](RECOVERY.md) before applying it. Neither resetting Hub nor uninstalling its CLI erases native conversations.

Cross-client interoperability here means shared archive retrieval through MCP. Native continuation, rewriting active session stores, multi-device replication and general all-area reconciliation are separate capabilities; they are not implied by successful archive capture.
