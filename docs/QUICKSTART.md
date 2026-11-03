# Quick start: one shared Hub

Agent Hub manages shared MCP tools, skills and instructions for Claude Code, Codex CLI and DeepSeek Harness. Start with one shared Hub; no project path or Git repository is required. Project memory and handoff are optional, separate setup.

## Install the CLI once

Requires Node.js **22.13 or newer**, npm, and at least one configured client. Git is needed for project memory and handoff files. Download/unpack the source, then run these commands from its directory:

```sh
npm ci
npm run build
npm install --global .
ahub --help
```

The package is currently private; `npm install --global agent-hub` from a public registry is not available yet. Install from the downloaded/built source directory using the final dot in `npm install --global .`. Afterwards use `ahub` from any directory; `agent-hub` is an equivalent executable name.

Local-folder global installation normally links to the source checkout. Keep that checkout, its built files and Node at stable paths: generated launchers and memory hooks bind to the installed runtime. If the shell cannot find `ahub`, check `npm prefix --global` and add its binary directory to PATH (on macOS/Linux, `<prefix>/bin`). Use a user-writable npm prefix or your Node version manager when permissions prevent installation.

For updates, build the desired source revision and run `npm install --global .` again, then preview quick to review any affected bindings. `npm uninstall --global agent-hub` removes the CLI executables; it does not reset Hub/client data. Preview and apply reset before uninstalling when you intend to restore the recorded originals.

## Set up the shared Hub

Run this from any folder:

```sh
ahub quick
```

This is a **preview** and writes nothing, including on the first run. It finds detected, enabled clients and shows collection of MCP definitions and complete skill bundles, delivery of existing shared rules/index, known conflicts and affected client scope. It does not inspect the current Git project, create repository files, import project memory or enable project hooks.

The Hub is stored at `~/.agent-hub` by default. This is the shared configuration/knowledge store, not a project directory. `AGENT_HUB_HOME` chooses another Hub location.

Copy the complete **Apply this workflow** command printed by your preview. It includes `--apply`, `--expect` and `--at`; do not invent a revision or drop options. Generated commands pin the installed Node and CLI paths deliberately; ordinary interactive commands use `ahub`. Changed inputs require a new preview.

After applying, read the per-stage result and restart affected clients. Native trust and permissions remain client-owned. Check configuration and, when desired, actual MCP connectivity:

```sh
ahub status
ahub doctor
```

`status` compares settings. `doctor` starts real MCP processes or connects to endpoints to discover tools; it does not invoke tools or start an offline backend.

## What each command changes

| Command                                 | Scope and result                                                                                                                                                                                                                                           |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ahub quick`                            | Shared Hub and global settings for selected clients: create missing Hub files, collect MCP/skills, deliver tools, skill links and existing shared instruction/index blocks. Personal text is preserved. No project setup or Git needed.                    |
| `ahub project connect /path/to/project` | One existing Git project: bind its memory, prepare missing handoff files, import matched Markdown notes and install project-gated hooks for selected clients. Requires an existing Hub. Does not import or sync global MCP, skills or shared instructions. |
| `ahub sync`                             | MCP settings only. Use `--area skills` or `--area context` to review an individual shared area.                                                                                                                                                            |
| `ahub init-repo`                        | Repository handoff files only. Does not register project memory or install hooks.                                                                                                                                                                          |
| `ahub memory …`                         | Read or manage explicitly scoped knowledge. Detailed operations retain their own workspace/scope options.                                                                                                                                                  |

Shared rules come from `instructions/AGENTS.md`; the shared index is `memory/MEMORY.md`. Empty sources have nothing to deliver. Global personal client instructions are not automatically imported into shared rules.

## Optional: connect a project

Once the shared Hub is ready, connect a project only when you want its memory and handoff:

```sh
ahub project connect /path/to/project
```

The path is **the Git project**, not the Hub directory. From inside that project, `ahub project connect` uses the current checkout. Unlike `quick`, this command validates the Git checkout and requires an initialized Hub. Apply its own emitted command after reviewing the scope.

Connection reuses an existing verified memory binding or creates a stable local ID; changed repository identity requires an explicit rebind. Existing repository notes and instructions are preserved. Only matched Markdown sources from selected clients are imported. Unknown-project sources and native SQLite stores need a separate review; source notes stay in place.

By default, connection enables that project's memory policy and installs client lifecycle hooks. Handlers are registered in client settings and reused across connected projects. These hooks are gated by project and policy; they do not authorize learning from every project. Restart clients and handle native hook permissions. Semantic learning uses the active model, which can return no useful facts. A standalone Memory MCP server is optional and configured separately for a fixed project; neither setup command installs it automatically.

```sh
# Select clients for the shared Hub
ahub quick --client claude-code,codex

# Explicit source preference for ambiguous new imports
ahub quick --prefer codex

# Connect a project without enabling new automation
ahub project connect /path/to/project --no-automation

# Enable project memory for selected clients only
ahub project connect /path/to/project --client codex
```

These commands preview. Use each plan's own apply command. `--no-automation` omits enablement; it does not turn off an existing policy. Use `memory auto disable` for a reviewed disable operation. The old `quick --workspace` form now directs you to `project connect`; `--no-project` is unnecessary for ordinary quick setup.

## Prefer the local UI?

```sh
ahub ui
```

**Set up shared Hub** works from any folder, even before Hub initialization. It previews global tools, skills and shared instructions only.

For optional project setup, start `ahub ui` from that Git project, then choose **Connect project memory** on Overview or **Connect project memory & handoff** on Repos & tasks. This is a separate preview with a visible project path and an explicit hook option. The server cannot be redirected to another directory through a browser request. Preview IDs expire after five minutes and apply once.

## Conflicts, repeat runs and automation boundaries

Neither setup command supplies implicit overwrite, replacement or rebind permissions. Existing Hub definitions remain authoritative. Without `--prefer`, ambiguous new MCP entries remain unimported and differing skill sources block collection. Later edits in a client are not silently merged into existing Hub entries.

For detailed collection, start with `ahub import mcp --dry-run` or `ahub import skills --dry-run`. MCP import retains its older behavior: without `--dry-run` it writes, unlike the setup commands. The local UI always previews before its import action.

A blocked client/area stays untouched while independent stages can finish. Results use `needs-review` and CLI exits 1 when work remains. Review MCP with `sync --client <id> --dry-run`, skills with `import skills --dry-run` / `sync --area skills --dry-run`, and queued memory conflicts with `memory auto conflict`.

Repeat `quick` to collect new shared items and deliver Hub state. Repeat `project connect` to review one project's setup. Unchanged runs create no new managed writes or backups. Neither command installs an OS service: MCP/skills need an explicit reviewed run, while enabled memory hooks act on client lifecycle events. A native-note foreground watcher is available separately.

## Restore or start over

Both are **staged workflows**, not one transaction. Dependent plans are rebuilt after earlier stages; a later failure can leave completed stages in place. Each writing stage retains its guards, lock and recovery mechanism. The scope preview is not a precomputed flat list of every dependent file edit.

Most writing stages provide individual restore preview commands. Restore dependent operations in reverse order and review each plan; later edits can block older backups. MCP import has first-baseline recovery rather than an individual restore backup.

```sh
ahub reset --dry-run
```

Apply only the emitted recovery command. Reset archives current data and returns to the **first baseline**, which may predate the current setup run. It is not undo-last-quick or disconnect-one-project. On a newly created Hub it can restore the path to absence and return recorded external files to their originals. See [RECOVERY.md](RECOVERY.md) for external edits and archive scope.

Use [WORKING_GUIDE.md](WORKING_GUIDE.md) for the detailed manual trial and isolated failure laboratory.
