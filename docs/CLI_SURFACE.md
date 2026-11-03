# Proposed CLI surface

Status: design proposal, not implemented. Existing command names and runtime invocations remain unchanged.

The current root help exposes 15 command groups. Most users need two entry points; specialized collection, delivery and memory machinery should remain available without competing with the first-run route.

## Default help

| Command   | Audience and purpose                                                            | Frequency                                 |
| --------- | ------------------------------------------------------------------------------- | ----------------------------------------- |
| `quick`   | Terminal user: preview and apply shared Hub setup/update                        | Initial setup and explicit shared updates |
| `ui`      | Any user: inspect configuration, choose projects and resolve conflicts          | Normal interactive management             |
| `status`  | Terminal user: inspect settings, cached connection evidence and memory activity | Inspection                                |
| `project` | Terminal user: optionally connect/disconnect project memory and handoff         | Project onboarding/lifecycle              |
| `doctor`  | User/support: probe actual MCP startup and tool discovery                       | Troubleshooting                           |
| `undo`    | User/support: review rollback of a recorded setup workflow                      | Recovery                                  |

Present quick/UI first, inspection/diagnostics second, and optional project/recovery actions last. The quick start should teach quick and UI, then explain optional project connection. It should not teach every storage operation.

`undo` currently targets quick/project-connect workflows, not every memory save or manual import. Its help and UI must keep that boundary explicit. Do not promise a universal last-action undo without extending the recovery model.

## Advanced human operations

| Existing commands                                      | Why they remain                                                       | Why they leave default help                                             |
| ------------------------------------------------------ | --------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `init`                                                 | Adopt/init Hub layout and Git deliberately                            | Quick already prepares normal Hub setup                                 |
| `import`, `sync --area …`                              | Exact source/item direction, controlled scripts, area-specific repair | UI and quick cover ordinary collection/delivery                         |
| `skill …`                                              | Precise bundle management in scripts or a terminal                    | UI covers ordinary management; status covers inventory                  |
| `memory ls/search/get/add/update/rm/import`            | Explicit scoped record management and scripts                         | UI/MCP expose the same storage service                                  |
| `memory discover/onboard`                              | Resolve unusual native sources or perform deliberate one-time import  | Project connect handles matched sources; UI handles source review       |
| `memory project register --rebind`                     | Explicit shared IDs, multiple checkouts and identity recovery         | Project connect handles normal binding                                  |
| `memory auto setup/enable/disable/sync/watch/conflict` | Fine control, foreground native-note watchers and diagnostics         | Normal setup/conflict review has higher-level entry points              |
| `init-repo`                                            | Handoff-only setup without project memory                             | A specialized subset of project connection                              |
| `restore`, `reset`                                     | Restore one stage or the first baseline                               | Different scopes require deliberate review, not another beginner choice |
| `mcp ls`                                               | Focused machine-readable inventory                                    | Status/UI cover ordinary inspection                                     |

Offer one clearly labeled advanced help/catalog view, preserving existing spellings, JSON output and exact reviewed commands. Hiding default help entries must not remove script support or replace working generated commands with new aliases.

## Client/runtime integration

`mcp run`, `memory serve` and native hook/checkpoint callbacks are integration entry points. Native clients call the MCP launcher; an optional Memory MCP configuration starts the fixed-project service; lifecycle handlers call their bound callback commands. They need stable documented contracts and diagnostic references, not first-run prominence. Manual invocation remains useful for integration troubleshooting.

Agents should normally use their configured tools and project policy. Users should not need to memorize runtime paths, checkpoint tokens, internal session arguments or record revisions.

## Interaction rules

- Keep the distinction between shared Hub setup and optional project connection.
- Consider making terminal quick show its preview and confirmation directly, without requiring users to learn `--interactive`. Explicit dry-run/JSON/noninteractive calls stay read-only; automation keeps exact revision approval.
- Show what changed, what needs review and the next useful action at the end of setup. Do not introduce a separate readiness command.
- Keep exact `--expect`, timestamps and runtime paths available in generated commands and advanced docs; GUI users apply the reviewed plan through a button.
- Document advanced capability rather than deleting it. Do not introduce another top-level command for every core service.
- Keep recovery scope names explicit: restore one stage, undo one setup workflow, reset the first baseline, disconnect one project's bindings without deleting knowledge.
