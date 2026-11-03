# Quick start: get a working Hub

Quick setup collects the configuration you already have and connects your detected clients in one reviewed workflow. It supports Claude Code, Codex CLI and DeepSeek Harness. No cloud account or Hub Git repository is required.

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

## Preview, apply, use

Choose your actual Git project:

```sh
ahub quick --workspace /path/to/project
```

This writes **nothing**, including on the first run. It shows detected clients, the proposed local Hub, MCP/skill collection, the project memory binding, matched Markdown sources, automation scope, known MCP conflicts and deferred delivery stages. By default the Hub is `~/.agent-hub`; `AGENT_HUB_HOME` selects another location.

Copy the complete **Apply this workflow** command printed by your preview. It includes `--apply`, `--expect` and `--at`; do not invent a revision or drop the selected options. Generated apply, launcher and hook commands deliberately pin the installed Node and CLI paths; normal interactive commands use `ahub`. Inputs are checked again before setup starts. A changed input requires a new preview.

After application, read the per-stage result, restart the affected client sessions, and accept any native client trust or permission prompts you choose to grant. Quick does not start the clients or bypass those prompts.

For a connectivity check, run:

```sh
ahub status
ahub doctor
```

`status` compares configuration. `doctor` starts real MCP processes/connects to endpoints and discovers tools; it does not invoke tools or start an offline backend.

## Prefer the local UI?

```sh
ahub ui
```

Open **Quick setup & sync** on Overview. Choose clients and whether to prepare the current project and enable automation, select **Preview setup & sync**, then **Apply quick setup**. The UI works with an uninitialized Hub and targets the workspace where its server was started. To target another project, change to that project and run `ahub ui` there. Preview IDs expire after five minutes and can be applied once.

## What you get

| Area            | Result                                                                                                                                                                                                                                                                    |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hub             | Missing `hub.yaml`, private `.env`, empty registry and secret ignore rules are created. Existing settings and Hub definitions are preserved. No Git commit or remote is created.                                                                                          |
| MCP             | New definitions are collected from selected clients; credentials move into the Hub environment. Client configurations use the shared Hub launcher after guarded delivery.                                                                                                 |
| Skills          | Complete local bundles are copied into Hub and delivered through managed links, including scripts and assets. No skill scripts are executed. Shared client roots retain their existing protections.                                                                       |
| Shared context  | Existing Hub rules and the shared memory index are delivered through owned instruction blocks. Personal text stays intact. Empty Hub sources have nothing to deliver. Global personal instructions are not imported into shared rules.                                    |
| Project handoff | A verified Git checkout gets a stable local memory binding and missing handoff files. Existing `AGENTS.md`, project notes and task notes are preserved. An existing binding is reused; changed repository identity requires explicit review.                              |
| Existing memory | Only project-matched Markdown sources from selected clients are imported. Source notes stay intact. Unknown-project sources and native SQLite stores are left for separate review.                                                                                        |
| Automation      | By default, selected clients receive project-gated hooks and an enabled project policy. Lifecycle events import followed native notes and request evidenced knowledge from the active model. The model may decline or produce no useful facts. No extra model is started. |

Project knowledge is loaded through the memory hooks. A standalone **Memory MCP server is optional** and is not installed by quick: it requires a separately chosen, fixed workspace and explicit permissions. See [MEMORY.md](MEMORY.md).

## Choose less, or resolve a source choice

```sh
# Only connect these detected, enabled clients
ahub quick --workspace /path/to/project --client claude-code,codex

# Deliberately prefer a source when collected copies differ
ahub quick --workspace /path/to/project --prefer codex

# Import project memory without enabling new automation
ahub quick --workspace /path/to/project --no-automation

# Global tools, skills and shared context only
ahub quick --no-project

# Machine-readable preview/result
ahub quick --workspace /path/to/project --json
```

These are previews. Use each preview's own apply command. `--no-project` and `--no-automation` omit setup stages; they do not disable a policy or hooks you enabled earlier. Outside a Git checkout, default quick performs global setup and explicitly skips project stages.

## Conflicts, repeat runs and automation boundaries

Quick never supplies `--overwrite`, `--replace` or `--rebind`. Without an explicit `--prefer`, ambiguous new MCP definitions stay unimported and differing skill sources block skill collection. Existing Hub definitions remain authoritative; later edits made in a client are not automatically merged back into an existing Hub MCP entry or skill.

A blocked client/area stays untouched while independent stages continue. For example, DSH MCP conflicts do not prevent Claude MCP delivery or project memory setup. The final result is `needs-review`, and CLI exits with code 1. Review MCP using `sync --client <id> --dry-run`, skills using `import skills --dry-run` / `sync --area skills --dry-run`, and queued memory conflicts using `memory auto conflict`. Prefer selecting an exact individual resolution over changing a broad preference just to clear a warning.

Run quick again whenever you want to collect new items and deliver Hub state. An unchanged setup creates no new managed writes or backups. This command is an explicit workflow, not a background synchronizer: MCP and skill edits require another reviewed run; enabled project memory hooks run at client lifecycle events. A foreground native-note watcher is available separately. There is no installed OS service.

## Restore or start over

Quick is a **staged workflow**, not one transaction. Each writing stage uses its existing lock, freshness checks and recovery mechanism. Dependent stages rebuild their guarded plans after collection. The initial approval covers this workflow and its selected scope; it is not a precomputed flat list of every final file edit. A failure can leave earlier stages completed, and the result lists those stages. An interrupted process can be inspected with `status` and a fresh quick preview.

Most writing stages print an individual `restore` preview command. Restore dependent stages in reverse order, and review each plan; subsequent changes can block an older backup. MCP import has first-baseline recovery rather than its own restore backup.

To preview returning the entire setup to its first recorded state:

```sh
ahub reset --dry-run
```

Apply the exact command printed by that plan. Current data is archived. If quick created a new Hub, reset removes it and restores recorded external originals. For an existing Hub, the first baseline may predate this quick run: reset is **not** an undo-last-quick command. External edits block by default; review deliberate archiving through [RECOVERY.md](RECOVERY.md).

Use [WORKING_GUIDE.md](WORKING_GUIDE.md) for the detailed manual test route, project-switching checks and isolated failure laboratory.
