# Local interface

Run `ahub ui` to open Agent Hub on your computer. The interface uses the same core operations as the CLI. Reading a page does not apply configuration changes.

## Find your data

- **Overview** shows inventory counts, conversations from your archive and detected clients. Skill and MCP totals count items found across clients; memory counts include shared records and the selected project. A failed archive read is shown as unavailable, never as zero conversations. Recent conversations use the same newest-first native date order as the chat list.
- **All data** has five categories: Chats, Skills, MCP servers, Instructions and Memory. Search applies to the selected category. Chats searches preserved messages; it also offers project and client filters. Overview search covers skill names, MCP definitions and shared index documents; it does not search archived messages.
- **Projects** shows verified repositories from captured chats. Each card shows one recorded root or representative path. Related working folders, including build/dependency directories and worktrees, are available in an expandable list. Ordinary folders and unavailable/unverified historical locations have separate expandable groups. Search covers all recorded locations. This presentation does not merge projects, discard paths or widen grants. Open a project's chats, or expand **Access & project settings** to connect clients, revoke access, rename or exclude a project. **Find more projects & inspect source coverage** opens metadata discovery. Finding a folder does not connect project memory.

Existing bookmarks such as `#/sessions?chat=...` and `#/skills?name=...` still work. New resource links use `#/data?type=chats` and the other categories. **Current folder context** keeps access to repository instructions, project notes and handoff setup.

## Read conversations

In **All data → Chats**, **Your local archive** shows saved conversation/event counts, captured data size and the current update state. Attachment references not saved locally have a separate expandable explanation; zero incomplete-conversation warnings are omitted. Expand **Sources & automatic updates** or use **Manage history sources** to see one card per client. Folder paths and detailed read times stay in each card's disclosure. Select supported stores and choose **Save chats to Hub** (or **Update archive now** for an existing archive). Native stores stay in place. The two update switches are shown together; index rebuilding is under **Storage & troubleshooting**.

The chat list shows a readable title, client, project and the date/time of its first available native record in your browser’s local timezone. By default, newer dates appear first; **Date → Oldest first** reverses the order. The whole filtered list is sorted before pagination, and chats without a known date stay at the end in either direction. Sorting uses the displayed first-record date, not the time of later messages or archive capture. The selected direction survives filters, pagination and reload through the page URL. Message-search results keep their event-search order. Hover over the time for its timezone; the open conversation shows it too. Existing archives derive this from a bounded saved-event prefix without reimport or rewriting the catalog. Missing or invalid native clocks show **Time unavailable**, never the capture time. Technical counts and preserved-version information live in conversation details. Native user/provider titles and delegated-task labels take priority over generated fallback excerpts. Derived titles skip terminal notices, runtime environment/instruction envelopes (including nested AGENTS blocks) and simple greetings, and remove pasted-content wrapper tags. Codex approval-review prompts get **Approval review**; recognizable build-output headers get **Build output**. DSH fallback excerpts do not cut task titles to 20 characters, and long request excerpts end at a word boundary with an ellipsis. Chats with no identifiable task retain an untitled fallback. Existing archives gain this presentation without another capture.

A conversation opens with readable messages. Reasoning and tool output can be expanded. **All events** also includes runtime context and technical records. **Conversation details & preserved versions** contains revision selection, native identity, project associations, preserved-source download and removal from the archive. **Read original event** is available on each message. Archived content is displayed as text, never executed.

**Update selected sources in the background** checks the saved selection every 30 seconds, even after closing the browser or Hub UI server. It shows running/retry/stopped status, the last complete update and per-source check/complete-read times. Turn it off before changing sources or manually rebuilding. Empty selections stay disabled. Optional **Resume selected updates when I sign in** previews owned macOS LaunchAgent/Linux systemd user files for the next session start, with guarded apply and recovery. It does not reload your current user manager.

Open a conversation and choose **Continue in…** to prepare original-message excerpts for Claude Code, Codex or DSH. Add an optional next step, review the pinned source references, then copy/download and paste into a new target conversation. Preparation is local/read-only; no separate model call, client launch or access grant occurs. Copy/download rechecks current access. See [history behavior and limits](HISTORY.md).

## Review changes

**Sources & settings** shows detected client locations, configuration differences, setup and MCP connection checks. Detection alone does not prove that a client is active or its backend is available.

**Review Hub setup** collects and delivers shared content through the existing staged workflow. Individual imports and delivery actions remain available here and in the relevant data category. Every write requires a preview and an explicit apply; scope, revision checks, backups and recovery still apply. Review a new preview after changing knowledge scope.

Memory records and native-memory automation are available through **Manage records** in Memory. The **Knowledge scope** selector chooses shared knowledge, the folder where the UI started or a registered project. The document list below contains shared index files, rather than individual knowledge records.

## Share MCP server settings

Open **All data → MCP servers**. Start with **Needs setup**:

- **Settings differ**: the same server name has different launch settings. The comparison names what differs, such as the program, arguments, address or credentials. This does not mean the server is offline. Keep separate settings if the difference is intentional.
- **Not in Hub**: choose a working client copy and **Add … copy to Hub**. This saves only that server in Hub; client files stay as they are.
- **Ready to connect**: Hub has a definition, but some selected clients do not have it yet. Choose **Add to …** for each client where you want it.
- **Settings match**: the launch settings agree. The client list distinguishes independent copies from connections that already use Hub. **Connect to Hub** replaces an equivalent independent entry with a Hub launcher after review.

Connections generated by another readable Agent Hub installation or Node version are recognized automatically when they point to this same Hub and server without launch overrides. They show **Uses Hub settings** and are kept in place; no copy choice or configuration write is needed. Missing installations, another Hub target and extra launch settings still need review. A Hub launcher is never offered as an original source to import. Configuration matching does not prove that a server is online.

When a client differs from Hub, choose a direction: **Use Hub settings in …** updates only that server in the named client; **Use … settings in Hub** replaces only the Hub definition. Saving a client copy in Hub does not automatically update other clients. Review each client connection separately. Disabled clients and clients outside the server’s selected scope remain separate.

Every action opens a preview. Check the named server and destination, then apply or cancel. Client writes keep unrelated entries and local tool policies, create a backup and reject plans when their inputs change. Restart affected clients after delivery.

**View settings** and **Compare all copies** contain technical details; credential values stay hidden. Several entries with the same name in one client require reviewing those entries in that client before choosing a source. **Test the connection** is separate and starts a server probe only when requested. **Advanced** retains batch import and delivery; a blocked delivery links back to the affected server’s settings choice.

## Navigation and appearance

Use Command/Ctrl+K to focus search. Keyboard focus has a visible outline; **Skip to content** bypasses navigation. Background reads preserve expanded details and focused controls within the same view. The theme button switches light/dark appearance and remembers it locally when browser storage is available. The layout adapts to a narrow screen.

The browser loads fonts, scripts and styles locally. It adds no frontend framework or remote asset dependency. CLI commands, native client formats, grants and recovery storage are unchanged by this interface rebuild.

<details>
<summary>Technical reference: HTTP, reviewed writes and connection jobs</summary>

`POST /api/quick/preview` accepts only `clients` and `prefer`. `POST /api/project/connect/preview` accepts only `clients` and `automation`; its project directory is the verified server-side selection or startup folder. The corresponding `/apply` routes consume private single-use `previewId` plus `revision`. A Hub preview cannot be applied through a project route. Unknown or cross-scope options are rejected. IDs expire after five minutes; writes share the UI operation guard and each stage's filesystem lock. No source-bearing internal plan enters the response. Each workflow is staged rather than one transaction.

## API

| Route                            | Purpose                                                                                                                                                 |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/mcp?name=…`            | Read-only comparison of a known server’s Hub/client copies, differing field names and sanitized settings; never arbitrary paths or credential values    |
| `GET /api/state`                 | Actual hub/client status, sanitized registry definitions, known hub Markdown documents, current repository context, refresh timestamp and session token |
| `GET /api/skill?name=…&source=…` | A skill selected from the discovered hub/client inventory; never an arbitrary filesystem path                                                           |
| `POST /api/import/preview`       | Build an MCP import plan without writing; accepts `item`, `source`, `prefer`, `overwrite`                                                               |
| `POST /api/import/apply`         | Apply a previously reviewed plan by opaque `id`; rebuild and compare its input revision first                                                           |
| `POST /api/sync/preview`         | Dry-run MCP sync with optional `client`, `only` and `replace`; return file/server actions and copyable CLI commands                                     |
| `POST /api/sync/apply`           | Apply a reviewed sync preview by `id`, with backups, ownership tracking, stale-input checks and rollback                                                |
| `POST /api/doctor/run`           | Start a background connection-check job; accepts `name`, `client`, `timeout`, returns 202 with a job ID                                                 |
| `GET /api/doctor/<id>`           | Poll incremental results and the final report                                                                                                           |
| `POST /api/doctor/cancel`        | Cancel a job by ID and stop active probe processes                                                                                                      |

POST requests require JSON and `X-Agent-Hub-Token`, obtained from `/api/state`. Host must match the bound local address; cross-origin and cross-site requests are rejected. Static files are allowlisted, responses are not cached and the page uses a restrictive content security policy. Errors from config parsers and subprocesses are not echoed to the browser because they can contain credentials.

Preview IDs expire after five minutes, are single-use and are bounded in memory. Import and sync writes share a lock within a UI server process. Import, sync, restore and initialization share one filesystem lock across CLI/UI processes. Doctor report merging uses that lock too. The input revision includes client definitions, registry, environment values and import options. Imports detect changes between preview and apply. Import records private hashes of reviewed client variants and the selected hub definition; sync may replace those exact variants after a source choice, while later edits remain conflicts. No credential values are stored in this provenance. Sync additionally checks each file immediately before atomic replacement. External clients do not honor the hub lock; a client write in the narrow interval between the final check and rename is still a limitation.

The UI supports import, dry-run sync, guarded client MCP writes, filtering and document inspection. Connection checks use background jobs with progress, cancellation and a shared, credential-safe cached report. Skills import/delivery, shared instruction/index delivery and repository setup use guarded content previews. Chats now provides full native-event capture, search, original-event windows and preserved versions. Projects includes a durable archive catalog and reviewed scoped MCP connections; see [history](HISTORY.md). Document editing and agent launch remain unimplemented. Unavailable features have explanatory states instead of working-looking controls with sample results.

## Doctor jobs

`src/core/diagnostics/doctor.ts` schedules bounded probes and saves the last report. Each isolated worker uses the official SDK to connect through `ahub mcp run`, then lists tools without invoking any. The parent enforces an overall deadline and stops the process group on macOS/Linux, including descendants that ignore graceful termination. Errors are classified into fixed messages; raw logs never cross the worker boundary into reports.

HTTP jobs return immediately and can be polled; only one doctor job runs at a time in each UI server. Closing the server cancels its jobs and waits for cleanup. Jobs are bounded in memory. CLI and UI reports share `state/doctor.json`; a registry/credential revision marks old results stale. Check timestamps are always visible. This is connection/tool discovery evidence, separate from configuration drift and upstream API health.

## Service availability

A server `health: {name, url}` enables a generic bounded readiness probe. An isolated integration preserves the n8n preset for existing configurations with `N8N_API_URL`. `DoctorResult.service` reports `ready`, `unavailable` or `unknown`, a fixed explanation and an optional HTTP status. URLs, response bodies and credentials are excluded. MCP status remains independent: an available MCP with an unavailable n8n backend has a warning badge, service details and a warning count. Rechecking updates the same cache and clears recovered warnings. No configuration is disabled or removed because of an outage.

The probe is an unauthenticated GET to the base URL plus `/healthz/readiness`, without URL userinfo, query, fragment, API headers or redirect following. A 401/403/404 or redirect is unknown, since the ingress may hide the endpoint. API permissions and workflow execution remain untested.

## Managed content operations

`POST /api/content/preview` accepts `skills-import`, `skills-sync`, `context-sync`, `init-repo` or `project-disconnect`. It returns only actions, paths, a revision and copyable commands. Source rules and memory text are excluded. `POST /api/content/apply` consumes the opaque preview ID, rebuilds the plan and applies it under the shared Hub lock. The same Host/Origin/token protections and five-minute, single-use preview lifetime apply. All content writes serialize with imports and MCP sync.

All data has skill import/delivery and instruction/index delivery controls. Projects → Current folder context provides repository preparation. Init-repo is bound to the selected verified project or startup folder. The isolated QA harness injects fixture-only content targets as well as MCP targets, so these controls never default to the developer's real client directories there.

## Evidence and project selection

Sources & settings distinguishes configuration matching, current/stale/missing MCP check evidence, hook installation and recent observed hook/checkpoint timestamps. A configured hook is not reported as observed. Submitted fact counts include empty acknowledgements and are not a quality claim. The memory metric counts canonical records, separately from read-only Markdown document previews; unconnected folders default record management to shared scope.

`POST /api/project/select` accepts a registered project ID, `@current` or null for shared knowledge. It validates a stored checkout's Git identity, creates a new bound memory session and expires setup, import, content, delivery and memory previews. Arbitrary paths are rejected. Per-item MCP/skill directions open scoped source-import or Hub-delivery previews, with replacement explicitly selected for only that item.

</details>

## Usage analytics

Basic collection is on by default. Sources & settings has a **Share basic usage statistics** checkbox. `ahub telemetry off` disables it for this user's CLI and local Hub UI; `ahub telemetry on` re-enables it with a new random installation ID. `ahub telemetry status` reports the effective setting and destination without creating an ID. Set `DO_NOT_TRACK=1` or `AGENT_HUB_TELEMETRY_DISABLED=1` to suppress collection without writing preferences. CI and Node test-runner processes suppress it too. The browser's DNT/GPC preference suppresses UI events.

Only named outcomes are sent: opening the UI, completing shared setup, completing a manual archive update, searching, opening a chat, exporting context and delivering changed shared configuration. Failed operations, previews, status polling and automatic capture do not count as activity. The export event means the packet was output, copied or downloaded, not that another client completed a task. Page refreshes/pagination are not extra chat-open/search events; same-name bursts within two seconds may be coalesced.

Payload fields are the event name, random installation UUID, app version and fixed UI language. No text, search phrase, chat ID, project name/path, client configuration, credentials, native session data or machine/account identifier is included. There is no third-party browser SDK, autocapture or recording. The local browser talks only to the local backend; a bounded detached worker sends once to the HTTPS relay, then PostHog. A relay timeout/outage loses the event and cannot fail the user's task. There is no retry queue or backfill.

Preferences live at `$XDG_CONFIG_HOME/agent-hub/telemetry.json` or `~/.config/agent-hub/telemetry.json`, outside the Hub's reset/restore data. Turning off removes the saved UUID; re-enabling creates a new one. A malformed, unreadable or symlink preference fails closed. An interrupted preference write may leave `telemetry.json.lock`; inspect that no settings update is running before removing the abandoned lock, or use `DO_NOT_TRACK=1`. File changes use a dedicated exclusive preference lock and checked replacement, not Hub recovery/locks. An already transmitted event cannot be recalled by the switch; deletion/retention of stored events is handled in PostHog.

Website collection has its own browser setting and UUID, and is never joined to an installation ID. These statistics describe participating installations and browsers, not unique people or every user. Reports must exclude `is_test=true`. Endpoint health/HTTP 202 is not proof of visibility in provider reports.

For controlled tests or a reviewed alternate deployment, `AGENT_HUB_TELEMETRY_STATE` overrides the private preference file and `AGENT_HUB_TELEMETRY_URL` accepts an HTTPS `/v1/events` endpoint without credentials/query/fragment. Never point synthetic tests at production.

`POST /api/telemetry/settings` accepts only `{ enabled: boolean }`; `/api/telemetry/event` accepts only a named `{ event }`; `/api/telemetry/status` accepts an empty object. All require the local session token and same-origin request protections. GET state includes only effective enabled/blocked/destination, not the UUID.
