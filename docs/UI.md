# Live local UI

The live application is in `ui/app/`, served by `src/ui/server.ts` through `ahub ui`. The original `ui/mockups/` remains available as a visual reference; both use `ui/app/base.css`. Live assets are self-contained.

The server calls the existing status collector and the shared `src/core/mcp/import-plan.ts` service. The CLI import command uses the same planner and writer. Internal plans contain secret values; only the explicit public plan projection is sent to the browser.

## Guided first run

Overview separates **Set up shared Hub** from optional **Connect project memory**. Hub setup works from any folder and previews global MCP, skill and shared instruction/index collection/delivery. The header selects a verified registered project, the startup folder or shared knowledge. Switching expires every preview. Project connection is available for the selected Git project and previews its memory, handoff and hooks. The scope and storage/project paths are labeled separately. Both results show completed, unchanged, skipped and blocked stages, restore previews, per-run undo and the separate first-baseline reset command. See [QUICKSTART.md](QUICKSTART.md).

`POST /api/quick/preview` accepts only `clients` and `prefer`. `POST /api/project/connect/preview` accepts only `clients` and `automation`; its project directory is the verified server-side selection or startup folder. The corresponding `/apply` routes consume private single-use `previewId` plus `revision`. A Hub preview cannot be applied through a project route. Unknown or cross-scope options are rejected. IDs expire after five minutes; writes share the UI operation guard and each stage's filesystem lock. No source-bearing internal plan enters the response. Each workflow is staged rather than one transaction.

## API

| Route                            | Purpose                                                                                                                                                 |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/state`                 | Actual hub/client status, sanitized registry definitions, known hub Markdown documents, current repository context, refresh timestamp and session token |
| `GET /api/skill?name=…&source=…` | A skill selected from the discovered hub/client inventory; never an arbitrary filesystem path                                                           |
| `POST /api/import/preview`       | Build an MCP import plan without writing; accepts `item`, `prefer`, `overwrite`                                                                         |
| `POST /api/import/apply`         | Apply a previously reviewed plan by opaque `id`; rebuild and compare its input revision first                                                           |
| `POST /api/sync/preview`         | Dry-run MCP sync for all enabled clients or one `client`; return file/server actions and copyable CLI commands                                          |
| `POST /api/sync/apply`           | Apply a reviewed sync preview by `id`, with backups, ownership tracking, stale-input checks and rollback                                                |
| `POST /api/doctor/run`           | Start a background connection-check job; accepts `name`, `client`, `timeout`, returns 202 with a job ID                                                 |
| `GET /api/doctor/<id>`           | Poll incremental results and the final report                                                                                                           |
| `POST /api/doctor/cancel`        | Cancel a job by ID and stop active probe processes                                                                                                      |

POST requests require JSON and `X-Agent-Hub-Token`, obtained from `/api/state`. Host must match the bound local address; cross-origin and cross-site requests are rejected. Static files are allowlisted, responses are not cached and the page uses a restrictive content security policy. Errors from config parsers and subprocesses are not echoed to the browser because they can contain credentials.

Preview IDs expire after five minutes, are single-use and are bounded in memory. Import and sync writes share a lock within a UI server process. Import, sync, restore and initialization share one filesystem lock across CLI/UI processes. Doctor report merging uses that lock too. The input revision includes client definitions, registry, environment values and import options. Imports detect changes between preview and apply. Import records private hashes of reviewed client variants and the selected hub definition; sync may replace those exact variants after a source choice, while later edits remain conflicts. No credential values are stored in this provenance. Sync additionally checks each file immediately before atomic replacement. External clients do not honor the hub lock; a client write in the narrow interval between the final check and rename is still a limitation.

The UI supports import, dry-run sync, guarded client MCP writes, filtering and document inspection. Connection checks use background jobs with progress, cancellation and a shared, credential-safe cached report. Skills import/delivery, shared instruction/index delivery and repository setup use guarded content previews. Chats now provides full native-event capture, search, original-event windows and preserved versions. Projects includes a durable archive catalog and reviewed scoped MCP connections; see [history](HISTORY.md). Document editing and agent launch remain unimplemented. Unavailable features have explanatory states instead of working-looking controls with sample results.

## Next

Run the personal workflow in [WORKING_GUIDE.md](WORKING_GUIDE.md), then complete release validation. Shared context delivery and repository templates are implemented; [CONTENT.md](CONTENT.md) defines their exact scope. Sync and restore are implemented in `src/core/mcp/sync.ts`, `config-edit.ts` and `restore.ts`; CLI and UI share the sync planner. Codex STDIO fields and local tool policies follow the [official OpenAI documentation](https://learn.chatgpt.com/docs/extend/mcp?surface=cli).

## Doctor jobs

`src/core/diagnostics/doctor.ts` schedules bounded probes and saves the last report. Each isolated worker uses the official SDK to connect through `ahub mcp run`, then lists tools without invoking any. The parent enforces an overall deadline and stops the process group on macOS/Linux, including descendants that ignore graceful termination. Errors are classified into fixed messages; raw logs never cross the worker boundary into reports.

HTTP jobs return immediately and can be polled; only one doctor job runs at a time in each UI server. Closing the server cancels its jobs and waits for cleanup. Jobs are bounded in memory. CLI and UI reports share `state/doctor.json`; a registry/credential revision marks old results stale. Check timestamps are always visible. This is connection/tool discovery evidence, separate from configuration drift and upstream API health.

## Service availability

A server `health: {name, url}` enables a generic bounded readiness probe. An isolated integration preserves the n8n preset for existing configurations with `N8N_API_URL`. `DoctorResult.service` reports `ready`, `unavailable` or `unknown`, a fixed explanation and an optional HTTP status. URLs, response bodies and credentials are excluded. MCP status remains independent: an available MCP with an unavailable n8n backend has a warning badge, service details and a warning count. Rechecking updates the same cache and clears recovered warnings. No configuration is disabled or removed because of an outage.

The probe is an unauthenticated GET to the base URL plus `/healthz/readiness`, without URL userinfo, query, fragment, API headers or redirect following. A 401/403/404 or redirect is unknown, since the ingress may hide the endpoint. API permissions and workflow execution remain untested.

## Managed content operations

`POST /api/content/preview` accepts `skills-import`, `skills-sync`, `context-sync`, `init-repo` or `project-disconnect`. It returns only actions, paths, a revision and copyable commands. Source rules and memory text are excluded. `POST /api/content/apply` consumes the opaque preview ID, rebuilds the plan and applies it under the shared Hub lock. The same Host/Origin/token protections and five-minute, single-use preview lifetime apply. All content writes serialize with imports and MCP sync.

The local UI has Skills import/delivery controls, context delivery on Instructions/Memory and Prepare repository on Repos & tasks. Init-repo is bound to the selected verified project or startup folder. The isolated QA harness injects fixture-only content targets as well as MCP targets, so these controls never default to the developer's real client directories there.

## Evidence and project selection

Overview distinguishes configuration matching, current/stale/missing MCP check evidence, hook installation and recent observed hook/checkpoint timestamps. A configured hook is not reported as observed. Submitted fact counts include empty acknowledgements and are not a quality claim. The memory metric counts canonical records, separately from read-only Markdown document previews; unconnected folders default record management to shared scope.

`POST /api/project/select` accepts a registered project ID, `@current` or null for shared knowledge. It validates a stored checkout's Git identity, creates a new bound memory session and expires setup, import, content, delivery and memory previews. Arbitrary paths are rejected. Per-item MCP/skill directions open scoped source-import or Hub-delivery previews, with replacement explicitly selected for only that item.
