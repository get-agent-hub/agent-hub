# Quick start: one shared Hub

Agent Hub manages shared MCP tools, skills and instructions for Claude Code, Codex CLI and DeepSeek Harness. Start with one shared Hub; no project path or Git repository is required. Project memory and handoff are optional, separate setup.

## Install the CLI once

Requires Node.js **22.13 or newer**, npm, and at least one configured client. Git is needed for project memory and handoff files. Download/unpack the source, then run these commands from its directory:

```sh
npm ci
npm run install:global
ahub --help
```

Candidate 0.1.0-beta.1 is distributed as reviewed source and package archives. The package stays private to prevent accidental registry publication; `npm install --global agent-hub` from a public registry is not an advertised installation route. Run `npm run install:global` from the downloaded source directory. It builds, packs and globally installs a standalone package copy with a production shrinkwrap. Afterwards use `ahub` from any directory; `agent-hub` is an equivalent executable name. See [RELEASE.md](RELEASE.md) for tarball installation, checksums and publication gates. Both installation routes may download locked dependencies from npm.

The source checkout may be removed after installation. Keep Node and the installed package at stable paths: generated launchers and memory hooks bind to the installed runtime. If the shell cannot find `ahub`, check `npm prefix --global` and add its binary directory to PATH (on macOS/Linux, `<prefix>/bin`). Use a user-writable npm prefix or your Node version manager when permissions prevent installation.

For updates, run `npm ci` and `npm run install:global` from the desired source revision again, then preview quick to review any affected bindings. `npm uninstall --global agent-hub` removes the CLI executables; it does not reset Hub/client data. Preview and apply reset before uninstalling when you intend to restore the recorded originals.

## Set up the shared Hub

Run this from any folder:

```sh
ahub quick
```

The command shows a **preview** before writing. In an interactive terminal it then asks for confirmation of that exact plan. Declining writes nothing. `--dry-run`, `--json` and noninteractive calls preview without prompting or writing. It finds detected, enabled clients and shows collection of MCP definitions and complete skill bundles, delivery of existing shared rules/index, known conflicts and affected client scope. It does not inspect the current Git project, create repository files, import project memory or enable project hooks.

The Hub is stored at `~/.agent-hub` by default. This is the shared configuration/knowledge store, not a project directory. `AGENT_HUB_HOME` chooses another Hub location.

Quick and project connect ask after the preview when stdin/stdout are terminals. The legacy `--interactive` flag remains supported, requires a terminal and cannot be combined with apply, JSON or dry-run. Otherwise, copy the complete **Apply this workflow** command printed by your preview. It includes `--apply`, `--expect` and `--at`; do not invent a revision or drop options. Generated commands pin the installed Node and CLI paths deliberately; ordinary interactive commands use `ahub`. Changed inputs require a new preview.

After applying, read the per-stage result and restart affected clients. Native trust and permissions remain client-owned. Check configuration and, when desired, actual MCP connectivity:

```sh
ahub status
ahub doctor
```

`status` compares configuration and distinguishes cached MCP checks, hook installation and recent observed memory activity. An untested or stale check remains visibly unverified; even an observed empty checkpoint does not prove useful facts were learned. `doctor` starts real MCP processes or connects to endpoints to discover tools; it does not invoke tools or start an offline backend.

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

In a terminal these public workflows show the plan and ask before applying. Use --dry-run to preview only. Noninteractive calls use each plan's own exact apply command. `--no-automation` omits enablement; it does not turn off an existing policy. Use `memory auto disable` for a reviewed disable operation. The old `quick --workspace` form now directs you to `project connect`; `--no-project` is unnecessary for ordinary quick setup.

## Prefer the local UI?

```sh
ahub ui
```

**Review Hub setup** works from any folder, even before Hub initialization. It previews global tools, skills and shared instructions.

The main navigation has three sections: **Overview** for counts and conversations, **All data** for chats, skills, MCP, instructions and memory, and **Projects** for saved conversation groups. **Sources & settings** contains setup, individual delivery actions and connection checks. Writes always require a preview and an explicit apply.

Metadata discovery starts automatically over known supported Claude Code, Codex and DSH stores. In **Projects**, expand **Find more projects & inspect source coverage** to inspect or repeat it. Git worktrees are grouped; ordinary and unavailable folders stay distinct. Finding a location does not connect memory or preserve complete history. In **All data → Chats**, select **Capture selected history** to preserve supported conversations and search their messages.

For optional project-memory setup, start `ahub ui` from a Git project, open **Projects → Current folder context** and choose **Connect project memory & handoff**. The preview identifies the project and optional hooks. **Knowledge scope** switches among registered projects, the startup folder and shared knowledge. Switching scope expires earlier setup/content/memory previews. Requests cannot select an arbitrary path; previews expire after five minutes and apply once.

These additions are in the current source checkout, rather than the published `v0.1.0-beta.1` archive. See [the UI guide](UI.md) and [history support and limits](HISTORY.md).

## Conflicts, repeat runs and automation boundaries

Neither setup command supplies implicit overwrite, replacement or rebind permissions. Existing Hub definitions remain authoritative. Without `--prefer`, ambiguous new MCP entries remain unimported and differing skill sources block collection. Later edits in a client are not silently merged into existing Hub entries.

For detailed collection, start with `ahub import mcp --dry-run` or `ahub import skills --dry-run`. Both imports preview by default and apply only with their exact reviewed `--expect` revision. There is no implicit winning client. The local UI always previews before its import action.

For one conflict, open its MCP/skill detail in the UI and choose **Use this client in Hub** or **Use Hub in this client**. The following CLI examples also preview only that item:

```sh
ahub import mcp:demo --source codex --overwrite
ahub sync --client codex --only=demo --replace=demo
ahub import skills:demo --source codex --overwrite
ahub sync --area skills --client codex --only=demo --replace=demo
```

`--only` preserves all unselected entries and their ownership. Skills can share physical client directories; the preview lists every affected client, and disabled shared clients still block replacement.

A blocked client/area stays untouched while independent stages can finish. Results use `needs-review` and CLI exits 1 when work remains. Review MCP with `sync --client <id> --dry-run`, skills with `import skills --dry-run` / `sync --area skills --dry-run`, and queued memory conflicts with `memory auto conflict`.

Repeat `quick` to collect new shared items and deliver Hub state. Repeat `project connect` to review one project's setup. Unchanged stages create no new content backups; every applied workflow retains its private per-run recovery snapshot. Neither command installs an OS service: MCP/skills need an explicit reviewed run, while enabled memory hooks act on client lifecycle events. A native-note foreground watcher is available separately.

## Restore or start over

Both are **staged workflows**, not one transaction. Dependent plans are rebuilt after earlier stages; a later failure can leave completed stages in place. Each writing stage retains its guards, lock and recovery mechanism. The scope preview is not a precomputed flat list of every dependent file edit.

Most writing stages provide individual restore preview commands. Restore dependent operations in reverse order and review each plan; later edits can block older backups. MCP import has first-baseline recovery rather than an individual restore backup.

```sh
ahub reset --dry-run
```

Apply only the emitted recovery command. Reset archives current data and returns to the **first baseline**, which may predate the current setup run. For a single recorded setup run, preview `ahub undo` instead. For project disconnection, preview `ahub project disconnect <id>`; knowledge and notes are retained. On a newly created Hub it can restore the path to absence and return recorded external files to their originals. See [RECOVERY.md](RECOVERY.md) for external edits and archive scope.

Use [WORKING_GUIDE.md](WORKING_GUIDE.md) for the detailed manual trial and isolated failure laboratory.

## Pause one project or undo a setup run

```sh
ahub project disconnect <project-id>
ahub undo
ahub undo <run-id>
```

Undo and disconnect show the plan and ask in an interactive terminal. Explicit dry runs, JSON and pipes remain read-only; apply requires the emitted revision. Disconnect covers all registered checkouts of that ID, disables its policy and removes pending session tokens. Knowledge, source bindings and repository handoff notes remain. Shared hook handlers remain installed for other projects. A later project connect rechecks the checkout identity before reusing its knowledge.

Undo restores the state immediately before a recorded quick/project-connect run, including a partially completed run. It rejects later changes to the Hub or touched external targets. Its output archives current data and keeps the independent first-baseline reset. Snapshots live outside Hub in its private recovery directory; they include personal configuration and consume disk space. A process killed before finishing snapshot metadata requires manual recovery review or the normal reset preview.

## Help without overload

Run `ahub` for six everyday groups and two starting routes: quick or ui. Use `ahub --advanced --help` for specialized operations, and `ahub --advanced quick --help` for technical flags used by generated script commands. Hidden help entries remain callable. [The command reference](CLI.md) explains who uses each command and why; runtime launchers and callbacks are separate from ordinary setup.

## Preserve and search conversations

Open `ahub ui` → **Chats** → **Capture selected history**, or run `ahub history scan`. Projects are found automatically from known local metadata. Capture preserves supported native events and source bytes; it does not replace active client session files. Use a saved project's **Connect clients…** action to review scoped read-only MCP access. See [Chats and projects](HISTORY.md) for source coverage, terminal commands, optional refresh, attachments and removal.
