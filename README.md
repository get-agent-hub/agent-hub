# Agent Hub

A local source of truth for the skills, MCP tools and shared context used by Claude Code, Codex and DeepSeek Harness.

Requires Node.js 20 or newer. This is an early, private development build.

```sh
npm install
npm run build
node dist/cli.js ui
```

The UI opens at **http://127.0.0.1:3082**. Stop the server with Ctrl+C. Use `--port 3083` to choose another port, or `--no-open` to open the page yourself. Start it from a repository to view that repository's project context.

The UI keeps the visual style of the [original HTML mockups](ui/mockups/README.md), with live data:

- **Overview:** detected clients, configuration differences and actual hub counts.
- **Skills:** filter the client matrix, select a skill, switch source clients and read its `SKILL.md`.
- **MCP servers:** compare definitions, inspect a credential-safe hub configuration, preview imports and dry-run synchronization. Choose a source preference for conflicts; existing definitions are skipped unless replacement is explicitly selected. Apply writes the reviewed plan into the hub and moves new secret values into `.env`. It does not write client configurations. A plan expires after five minutes and must be reviewed again if its inputs change.
- **Instructions and memory:** view existing hub Markdown documents. Empty directories have empty states. Editing and client delivery are not implemented yet.
- **Repos & tasks:** view `AGENTS.md` and `.agents/state/{PROJECT,NOW}.md` in the repository where the server was started. No repository scanning or agent launching yet.
- **Sessions:** shows the planned work; no session index is created.

Search filters skills, MCP servers and memory; ⌘K / Ctrl+K focuses it. The theme follows your system until you choose a theme in the UI. Refresh rereads files from disk.

## Sync: dry run and an exact command

```sh
node dist/cli.js sync --dry-run
node dist/cli.js sync --client dsh --dry-run
node dist/cli.js sync --json
```

Dry run is the default and writes nothing. It shows each target file, server action and launcher command, then prints an executable apply command with `--expect <revision>`. Copy that command to apply precisely the reviewed inputs. `--apply` is required for any write; combining it with `--dry-run` is rejected.

The UI's **Sync → clients** button opens the same plan. Copy either the dry-run command or the exact apply command, or choose **Apply with backup**. A changed input or expired preview requires another dry run. You can select DSH, Codex or Claude separately.

Sync changes MCP definitions only. It preserves client-only entries, unrelated JSON values and TOML/YAML text, and existing Codex tool policies. Disabled clients and application-managed servers such as `node_repl` are skipped. A source chosen during import authorizes replacing the exact client variants reviewed in that import. Private hash-only provenance records this choice; credentials are not stored in it. A later local edit still conflicts rather than being overwritten. Inline/dotted Codex MCP assignments require explicit server tables; unsupported transport settings are blocked for review.

Before writing, sync saves private backups in `hub/backups/<id>/`, uses guarded atomic writes and records ownership hashes. If a later write fails, it rolls back the earlier writes. A later removal from the registry removes only previously owned definitions that have not been changed locally.

```sh
node dist/cli.js restore <backup-id> --dry-run
```

Restore also defaults to dry run and prints an exact apply command. It refuses to overwrite a client file or ownership state changed since that backup. Restart affected clients after sync or restore.

Configuration comparisons describe effective launch definitions, not server health. Different launchers and secret references may start equivalent tools. Status resolves hub secret references and recognizes the current hub launcher, so direct equivalent definitions and generated launchers compare consistently. Shared instruction delivery and repository initialization remain later steps.

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

`AGENT_HUB_HOME` selects a hub directory instead of `~/.agent-hub`. See [DESIGN.md](docs/DESIGN.md) for the architecture and remaining work.

## Development

```sh
npm run dev -- ui --no-open
npm run typecheck
npm test
```

The frontend uses plain HTML/CSS/JavaScript and the existing mockup styles; no frontend build or extra dependencies are needed. Keep both `ui/app` and `ui/mockups/app.css` alongside `dist` when running the compiled CLI.

The local server binds to `127.0.0.1` only. It validates the request host and origin, requires a session token for writes and serves a fixed allowlist of assets. Config values and `.env` are never served as files; MCP previews contain references and redacted values. Known Markdown files are shown as escaped text. The UI shares import planning and application with the CLI, rather than shelling out to commands.

Tests use isolated temporary hubs and fixture clients. They cover imports, sync and restore, secret-safe previews, stale plans, permissions and scope preservation, idempotence, atomic rollback, symlinks, CLI defaults and HTTP operations. Doctor tests use independent fixture MCP processes to verify handshake order, pagination, errors, deadlines, process cleanup, cancellation and report redaction. Real client files are not modified by the tests.

For hands-on UI testing without changing your client configurations:

```sh
npm run qa:ui
```

This opens a separate fixture server at **http://127.0.0.1:3083** with temporary JSON, TOML and YAML clients, sample documents and local MCP processes. The console prints the fixture directory. Stop it with Ctrl+C; its files are retained for inspection. Import, sync and doctor in this instance operate on the fixture. Copyable commands are production CLI commands: the fixture's injected three-client paths are not CLI defaults, so its revision guard prevents applying them outside that context. Use the normal UI/CLI for real command copying. See [QA.md](docs/QA.md) for the verified scenarios.
