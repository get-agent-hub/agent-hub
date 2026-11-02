# Live local UI

The live application is in `ui/app/`, served by `src/ui/server.ts` through `ahub ui`. The original `ui/mockups/` remains available as a visual reference; both use `ui/app/base.css`. Live assets are self-contained.

The server calls the existing status collector and the shared `src/core/import-plan.ts` service. The CLI import command uses the same planner and writer. Internal plans contain secret values; only the explicit public plan projection is sent to the browser.

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

The UI supports import, dry-run sync, guarded client MCP writes, filtering and document inspection. Connection checks use background jobs with progress, cancellation and a shared, credential-safe cached report. Document editing, instruction delivery, repository initialization, agent launch and session indexing are not implemented. Unavailable features have explanatory states instead of working-looking controls with sample results.

## Next

Add shared instruction/memory delivery and repository handoff templates. Sync and restore are implemented in `src/core/sync.ts`, `config-edit.ts` and `restore.ts`; CLI and UI share the sync planner. Codex STDIO fields and local tool policies follow the [official OpenAI documentation](https://learn.chatgpt.com/docs/extend/mcp?surface=cli).

## Doctor jobs

`src/core/doctor.ts` schedules bounded probes and saves the last report. Each isolated worker uses the official SDK to connect through `ahub mcp run`, then lists tools without invoking any. The parent enforces an overall deadline and stops the process group on macOS/Linux, including descendants that ignore graceful termination. Errors are classified into fixed messages; raw logs never cross the worker boundary into reports.

HTTP jobs return immediately and can be polled; only one doctor job runs at a time in each UI server. Closing the server cancels its jobs and waits for cleanup. Jobs are bounded in memory. CLI and UI reports share `state/doctor.json`; a registry/credential revision marks old results stale. Check timestamps are always visible. This is connection/tool discovery evidence, separate from configuration drift and upstream API health.

## Service availability

A server `health: {name, url}` enables a generic bounded readiness probe. An isolated integration preserves the n8n preset for existing configurations with `N8N_API_URL`. `DoctorResult.service` reports `ready`, `unavailable` or `unknown`, a fixed explanation and an optional HTTP status. URLs, response bodies and credentials are excluded. MCP status remains independent: an available MCP with an unavailable n8n backend has a warning badge, service details and a warning count. Rechecking updates the same cache and clears recovered warnings. No configuration is disabled or removed because of an outage.

The probe is an unauthenticated GET to the base URL plus `/healthz/readiness`, without URL userinfo, query, fragment, API headers or redirect following. A 401/403/404 or redirect is unknown, since the ingress may hide the endpoint. API permissions and workflow execution remain untested.
