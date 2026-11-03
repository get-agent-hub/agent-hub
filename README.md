# Agent Hub

A local source of truth for the skills, MCP tools and shared context used by Claude Code, Codex and DeepSeek Harness.

Requires Node.js **22.13 or newer** and npm. macOS and Linux are the supported release targets; Windows remains experimental. The npm package is marked private until its public name and first release version are chosen.

```sh
npm ci
npm run build
node dist/cli.js quick --workspace /path/to/project
```

`quick` previews one workflow: create/adopt Hub, collect MCP and skills, prepare the selected Git project, import its matched Markdown memory, enable project hooks, and deliver to detected clients. Copy its complete **Apply this workflow** command to run it. Conflicts require review; independent stages can finish. Existing Hub definitions stay authoritative, and native SQLite memory is not imported. Restart affected client sessions afterwards.

For a graphical first run, use `node dist/cli.js ui` and choose **Quick setup & sync** on Overview. No prior `init` is needed. See [QUICKSTART.md](docs/QUICKSTART.md) for expected results, scope options, repeat runs and recovery. Quick is a staged workflow; `reset` returns to the first recorded baseline, which can predate this run.

The UI opens at **http://127.0.0.1:3082**. Stop the server with Ctrl+C. Use `--port 3083` to choose another port, or `--no-open` to open the page yourself. Start it from a repository to view that repository's project context.

The UI keeps the visual style of the [original HTML mockups](ui/mockups/README.md), with live data:

- **Overview:** guided Quick setup & sync, per-stage outcomes, detected clients, configuration differences and actual Hub counts.
- **Skills:** inspect the client matrix and SKILL.md, preview imports, choose source preference and deliver complete skill bundles through individual client links with backups.
- **MCP servers:** compare definitions, inspect a credential-safe hub configuration, preview imports and dry-run synchronization. Choose a source preference for conflicts; existing definitions are skipped unless replacement is explicitly selected. Apply uses one hub lock and guarded writes for credentials, registry and import provenance, rolling back earlier writes if a later write fails. It never stages or commits unrelated hub files. It does not write client configurations. A plan expires after five minutes and must be reviewed again if its inputs change.
- **Instructions and memory:** deliver shared rules/index through owned client instruction blocks. Discover existing client memory, review its project scope and import selected Markdown knowledge through CLI or UI. Manage the same scoped records through CLI, UI or an optional MCP server. Project automation imports selected native notes and requests semantic checkpoints from the active agent under a one-time enabled policy, with conflict protection and recovery. Personal text and native sources are preserved.
- **Repos & tasks:** inspect the current repository and preview guarded init-repo setup of AGENTS.md, PROJECT.md, NOW.md and the Claude import. Existing notes are preserved. Repository scanning and agent launching remain future work.
- **Sessions:** shows the planned work; no session index is created.

Search filters skills, MCP servers and memory; ⌘K / Ctrl+K focuses it. The theme follows your system until you choose a theme in the UI. Refresh rereads files from disk.

## Skills, shared context and repository handoff

```sh
node dist/cli.js import skills --dry-run
node dist/cli.js skill add /path/to/local-skill --dry-run
node dist/cli.js sync --area skills --dry-run
node dist/cli.js sync --area context --dry-run
node dist/cli.js init-repo --dry-run
```

These new commands default to preview and require the exact `--apply --expect` command printed by that plan. MCP import retains its existing behavior: without `--dry-run`, it writes. Plain `sync` still means MCP; select skills or context explicitly. UI pages expose the corresponding review/apply actions.

Skills are copied with scripts/assets and then linked into selected client roots. Context delivery preserves personal text and delivers common rules plus the shared memory index; it does not relocate native automatic memory. Init-repo prepares normal project files and never stages or commits Git work. Content backups work with `restore`, and `reset` includes first-touch originals of managed files, directories and links.

See [CONTENT.md](docs/CONTENT.md) for delivery contracts, [MEMORY.md](docs/MEMORY.md) for scoped records and MCP setup, [AUTOMATION.md](docs/AUTOMATION.md) for native-note sync and automatic checkpoints, and [WORKING_GUIDE.md](docs/WORKING_GUIDE.md) for a first personal run. `mcp add/rm`, graph-memory interchange and archived session indexing remain unimplemented.

## MCP sync: dry run and an exact command

```sh
node dist/cli.js sync --dry-run
node dist/cli.js sync --client dsh --dry-run
node dist/cli.js sync --json
```

Dry run is the default and writes nothing. It shows each target file, server action and launcher command, then prints an executable apply command with `--expect <revision>`. Copy that command to apply precisely the reviewed inputs. `--apply` is required for any write; combining it with `--dry-run` is rejected.

The UI's **Sync MCP only** button opens the same plan. Copy either the dry-run command or the exact apply command, or choose **Apply with backup**. A changed input or expired preview requires another dry run. You can select DSH, Codex or Claude separately.

Sync changes MCP definitions only. It preserves client-only entries, unrelated JSON values and TOML/YAML text, and existing Codex tool policies. Disabled clients and application-managed servers such as `node_repl` are skipped. A source chosen during import authorizes replacing the exact client variants reviewed in that import. Private hash-only provenance records this choice; credentials are not stored in it. A later local edit still conflicts rather than being overwritten. Inline/dotted Codex MCP assignments require explicit server tables; unsupported transport settings are blocked for review.

To migrate an existing conflicting client record while keeping the hub definition, select exact names and one client:

```sh
node dist/cli.js sync --client dsh --replace example-server --dry-run
```

The plan explicitly marks these replacements. Its copied apply command includes `--replace` and the reviewed `--expect` revision; applying an explicit replacement without that revision is rejected. Other conflicts, unsupported fields, missing variables and application-owned servers retain their normal protections. The hub registry and credentials are not rewritten by this operation. No wrapper names or migration-specific script paths are recognized automatically.

Before writing, sync saves private backups in `hub/backups/<id>/`, uses guarded atomic writes and records ownership hashes. If a later write fails, it rolls back the earlier writes. A later removal from the registry removes only previously owned definitions that have not been changed locally.

```sh
node dist/cli.js restore <backup-id> --dry-run
```

Restore also defaults to dry run and prints an exact apply command. It refuses to overwrite a client file or ownership state changed since that backup. Restart affected clients after sync or restore.

To return to the first recorded state across multiple operations:

```sh
node dist/cli.js reset --dry-run
```

Before managed writes, originals are captured privately outside the hub in `<AGENT_HUB_HOME>.recovery`. Reset archives current data and restores recorded originals; `--apply` requires the reviewed `--expect` revision. Later client edits block by default. Existing installations without historical originals get an explicitly labeled checkpoint on their next managed write; no command can invent their pre-install state. See [RECOVERY.md](docs/RECOVERY.md) for scope, external edits, dead-lock recovery and filesystem limits.

Configuration comparisons describe effective launch definitions, not server health. Different launchers and secret references may start equivalent tools. Status resolves hub secret references and recognizes the current hub launcher, so direct equivalent definitions and generated launchers compare consistently. Shared context delivery uses `sync --area context`; repository setup uses `init-repo`. Both have separate guarded plans.

## MCP connection checks

```sh
node dist/cli.js doctor
node dist/cli.js doctor firecrawl --timeout 30
node dist/cli.js doctor --client dsh --json
```

`doctor` starts each selected server through the same hub launcher used by the clients, performs MCP initialization and walks every `tools/list` page. It does not call tools or test provider API operations. A passed check confirms connection and discovery; it does not prove that credentials for every upstream operation are valid. Resource-only servers can pass initialization without advertising tools.

For a server with an explicitly configured `N8N_API_URL`, doctor also probes its `/healthz/readiness` endpoint independently of MCP. The unauthenticated GET sends no API key, removes URL query/fragment data, follows no redirects and has a maximum three-second budget. HTTP 5xx, DNS, connection refusal, TLS and timeout failures produce a separate service warning; they do not fail or disable a healthy MCP. Protected, redirected or missing endpoints are marked unknown. Start the service and recheck to clear the warning. Readiness does not verify API credentials. Other providers currently have MCP discovery checks only.

A broken `npx` cache (`ENOTEMPTY` during rename) is reported as a package-cache problem separately from network or temporary HTTP 502/503/504 service failures. Doctor never repairs caches or restarts deployments automatically.

The CLI shows status, tool count, elapsed time and a fixed error description with a next step. Use `--timeout <seconds>` (default 20, range 0.1–120) for the total per-server budget. Checks run two at a time. Application-owned servers are skipped; `--client` also respects scope and disabled client definitions. Ctrl+C cancels active and queued checks.

In the UI, **Check MCP** opens a progress dialog with server, client scope and timeout choices. It supports cancellation and command copying. The MCP table shows the last connection status separately from configuration differences; the detail panel shows tool count, duration and check time. Refresh reads the shared report in `hub/state/doctor.json`; registry or credential changes mark cached results stale. Closing a running check cancels it.

On macOS/Linux each probe has its own process group. Timeout, cancellation and completion stop the worker, launcher and inherited child processes, escalating to a forced stop when necessary. Windows uses child-process termination; descendant cleanup has not been verified there.

Reports contain no raw server stdout, stderr, response bodies or credential values. They include local checks for private `.env` permissions, built launcher files and broken skill links. Reports are saved atomically with mode 600. The implementation uses the [official MCP TypeScript SDK client](https://ts.sdk.modelcontextprotocol.io/client).

## CLI

```sh
node dist/cli.js status
node dist/cli.js status --json
node dist/cli.js init
node dist/cli.js import mcp --dry-run
node dist/cli.js import mcp
node dist/cli.js mcp ls
node dist/cli.js mcp run <name>
```

`AGENT_HUB_HOME` selects a hub directory instead of `~/.agent-hub`. Client locations respect `CLAUDE_CONFIG_DIR`, `CODEX_HOME` and `DSH_HOME`; `AGENT_HUB_CLAUDE_CONFIG` and `AGENT_HUB_SHARED_SKILLS` override the Claude JSON file and shared skills directory. `AGENT_HUB_DSH_PROFILE` overrides the DSH profile in `hub.yaml`. See [DESIGN.md](docs/DESIGN.md) for the architecture and remaining work.

## Development

```sh
npm run dev -- ui --no-open
npm run check
npm run test:coverage
npm run package:check
```

The frontend uses plain HTML/CSS/JavaScript and the existing mockup styles; no frontend build or extra dependencies are needed. Keep `ui/app` alongside `dist` when running the compiled CLI. The package allowlist includes these assets automatically.

The local server binds to `127.0.0.1` only. It validates the request host and origin, requires a session token for writes and serves a fixed allowlist of assets. Config values and `.env` are never served as files; MCP previews contain references and redacted values. Known Markdown files are shown as escaped text. The UI shares import planning and application with the CLI, rather than shelling out to commands.

Tests use isolated temporary hubs, client directories and project repositories. Content checks cover complete bundles, metadata, shared roots, shadow copies, instruction block ownership, repository templates, copied CLI commands, HTTP preview protection and artifact recovery. They cover imports, sync and restore, secret-safe previews, stale plans, permissions and scope preservation, idempotence, atomic rollback, symlinks, CLI defaults and HTTP operations. Doctor tests use independent fixture MCP processes to verify handshake order, pagination, errors, deadlines, process cleanup, cancellation and report redaction. Real client files are not modified by the tests.

For hands-on UI testing without changing your client configurations:

```sh
npm run qa:ui
```

This opens a separate fixture server at **http://127.0.0.1:3083** with temporary JSON, TOML and YAML clients, sample documents and local MCP processes. The console prints the fixture directory. Stop it with Ctrl+C; its files are retained for inspection. Import, sync and doctor in this instance operate on the fixture. Copyable commands are production CLI commands: the fixture's injected three-client paths are not CLI defaults, so its revision guard prevents applying them outside that context. Use the normal UI/CLI for real command copying. See [QA.md](docs/QA.md) for the verified scenarios.

Any service can declare an optional unauthenticated readiness endpoint:

```yaml
version: 1
servers:
  example:
    command: node
    args: [server.mjs]
    health:
      name: Example service
      url: ${EXAMPLE_URL}/ready
```

Health metadata does not affect launch equivalence or client settings. The n8n preset is an isolated compatibility integration. See [CONTRIBUTING.md](CONTRIBUTING.md) for development checks and [the code review](docs/CODE_REVIEW.md) for findings and release limits.
