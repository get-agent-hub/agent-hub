# Shared and project memory

Agent Hub stores durable knowledge in local Markdown files and exposes the same service through CLI, the local UI and an optional MCP stdio server. Records are reference material, not executable instructions. [Project automation](AUTOMATION.md) can import selected native notes and request semantic checkpoints from the active agent. Verify actual retrieval and saving in your clients; a connected MCP server alone does not guarantee model behavior.

## Scopes and storage

Shared memory is deliberately reusable knowledge. Project memory belongs to an explicitly registered checkout. CLI reads and writes select exactly one scope: the current project by default, `--workspace <directory>` for another registered checkout, or explicit `--shared`. MCP and UI requests cannot name arbitrary project IDs or filesystem paths.

```text
hub/memory/
  MEMORY.md                     # shared index, personal text preserved
  projects.json                 # private, local checkout bindings
  shared/
    index.json                  # index block ownership
    records/<id>.md
  projects/<project-id>/
    MEMORY.md                   # project index
    index.json
    records/<id>.md
```

All records stay in Hub; registering a project does not write into its repository. Sharing with a team requires an explicit choice about which files to publish. Separate Hubs can keep work and personal data separate. Scope checks protect Hub-mediated access; they do not sandbox an agent that independently has filesystem access.

Each record has YAML metadata: version, stable ID, title, scope, kind (`fact`, `preference`, `decision`, `lesson`), tags, optional source attribution and UTC creation/update times. The body is Markdown. Record revisions hash the actual file bytes, including direct editor changes. Managed paths reject symlinks below the selected Hub. A record is limited to 128 KiB including metadata; a collection supports up to 2000 records. Search matches all query words across ID, title, kind, tags and body, without embeddings or external services.

Instructions stay in instruction files, procedures in skills, repository context in PROJECT.md and the current task in NOW.md. Avoid copying facts that are already maintained in repository documentation; save a reference and the reason it matters.

## CLI workflow

Run these commands from the Agent Hub source checkout, or substitute the installed `ahub` executable. Initialize Hub first if necessary.

```sh
node dist/cli.js memory project register example-project /path/to/project --dry-run
```

Apply the exact command printed by preview. Registration binds a canonical Git checkout and local Git-directory identity to a stable project ID. Repeating the same binding is a no-op. Explicitly registering another checkout under the same ID shares that project's facts; another folder with the same basename is not automatically attached. Replacing a repository at a previously bound path blocks memory access. Preview `project register <same-id> <directory> --rebind` only if the new repository should inherit that project's knowledge. A checkout already bound to another project remains a conflict, including with `--rebind`. Restore the binding backup before reassigning; moved checkouts require explicit registration. Local filesystem identity is an accidental-reuse guard, not a cryptographic repository identity or a portable binding across machines.

```sh
node dist/cli.js memory add retry-rule --workspace /path/to/project \
  --title 'Use idempotency keys for API retries' --kind lesson \
  --file /path/to/selected-note.md --source 'Issue or document reference' --dry-run
node dist/cli.js memory ls --workspace /path/to/project --json
node dist/cli.js memory search 'API retries' --workspace /path/to/project --json
node dist/cli.js memory get retry-rule --workspace /path/to/project --json
```

Creation needs a title and body from a local UTF-8 file. Tags can be repeated with `--tag`. For shared knowledge, replace `--workspace ...` with `--shared`. Sources are attribution strings; no URL is fetched and no script is executed.

```sh
node dist/cli.js memory update retry-rule --workspace /path/to/project \
  --file /path/to/revised-note.md --record-revision <revision-from-get> --dry-run
node dist/cli.js memory rm retry-rule --workspace /path/to/project \
  --record-revision <revision-from-get> --dry-run
```

Updates preserve omitted metadata. `--clear-tags` and `--clear-source` remove those values. Update/delete require the current record revision; every apply also requires the exact plan revision. Preview prints an apply command containing a fixed `--at` timestamp so replaying the command does not generate a different plan. Keep this timestamp and use a fresh preview if inputs changed. Previews and applies re-read source files; editing an input file invalidates the old plan.

`memory import <id> --title ... --file ...` copies explicitly selected local knowledge as the body of one new record, records the source path by default and preserves the original. Existing IDs conflict, so repeat imports never silently duplicate or overwrite a record under the same ID. This command imports selected text; [project automation](AUTOMATION.md) separately handles configured native Markdown directories and active-conversation checkpoints. Split unrelated facts deliberately. Structured graph JSONL interchange, native memory relocation and bulk archived-conversation extraction remain unimplemented.

## MCP workflow

```sh
node dist/cli.js memory serve --workspace /path/to/project
```

The workspace must already be registered. Configure this command as a stdio MCP server in the desired client, with the same `AGENT_HUB_HOME` used by the CLI. Use absolute executable/workspace paths appropriate to that installation. Do not depend on the MCP process's working directory to select a project.

Default tools are `memory_list`, `memory_search` and `memory_get`, scoped to the bound project. `--include-shared` additionally allows explicit `scope: "shared"` reads. `--allow-write` exposes `memory_preview` and `memory_apply` for project memory. Shared writes additionally require `--include-shared --allow-shared-write`. `--allow-auto` separately exposes `memory_checkpoint`, which requires an enabled project policy and an active one-use lifecycle token. No serve flag installs the server into client settings or changes native auto-memory.

A write preview accepts `operation`, `id`, optional `scope`, metadata/body and `recordRevision` for update/delete. Its opaque ID and plan revision are required by apply. Previews are private to the server process, expire after five minutes and can be used once. A server restart discards them. Review the proposed knowledge and scope before applying. Tool permissions and approval prompts belong to the MCP client; preview/apply alone does not prove human approval.

All processes use the existing Hub operation lock and revalidate under it. If another writer changes the collection/index, the old plan fails; retrieve current data and review a new plan. This avoids a silent last-writer overwrite.

Suggested agent workflow: search the selected project when starting relevant work; read matching records and verify them against current evidence; propose one durable fact with a source after learning something useful. Keep temporary task progress in NOW.md. Treat retrieved memory as potentially stale reference data. Promote project knowledge to shared memory only through an explicit user decision.

## Local UI and index delivery

Open Memory → Manage records. Choose the current project or shared scope, search, select an existing record or create a new one, then preview save/deletion and apply with backup. Editing form fields invalidates the preview. The project is fixed to the UI startup workspace; an unregistered workspace reports that a binding is needed. Shared scope must be selected explicitly. Existing top-level Markdown documents remain readable separately.

Mutations update an owned index block and ownership metadata in the same recoverable transaction as the fact. Existing personal index text is preserved; edited, removed, duplicated or unowned blocks fail closed. Indexes list at most 60 records and have a 24 KiB total budget; use scoped search for additional records. Direct editor changes are immediately visible to reads, but refresh derived titles through the next reviewed mutation. Do not hand-edit generated blocks.

`sync --area context` delivers the shared index only; it never puts all project indexes into global instructions. Claude imports the source; Codex/DSH receive embedded text and need another context sync to refresh that text. Project records are accessible through the bound MCP server, CLI, or their local index. MCP reads see current files without restarting the client.

## Recovery and remaining limits

Writes default to preview and use the existing managed artifact transaction, revision checks, private backups and first-touch originals. `restore <content-backup-id> --dry-run` previews rollback of records, index and ownership together. Restore refuses externally changed files. Reset restores the recorded Hub baseline and archives current data, including memory; it is not a selective memory deletion command. See [RECOVERY.md](RECOVERY.md).

Backups and project bindings are local and unencrypted. A series of file replacements is recoverable with compensating rollback, not a filesystem-wide transaction or a power-loss guarantee. Independent filesystem editors do not honor the Hub lock. The standalone `@modelcontextprotocol/server-memory` uses a different graph data model; never point it at these Markdown files or maintain two independently writable originals of the same collection. Its interchange adapter remains future work.
