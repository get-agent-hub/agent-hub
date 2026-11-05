# Relationships users should not have to configure

[Proposal](README.md) · [Evidence](EVIDENCE.md) · [Acceptance](DELIVERY.md)

This catalog preserves the earlier chat-to-project research and extends its consequences. “Automatic” means recording supported evidence; it does not authorize changing client/project files. All capabilities below are targets unless the evidence document identifies existing implementation.

| Relationship                           | Reliable evidence                                            | User benefit                                                   | Boundary                                                                                           |
| -------------------------------------- | ------------------------------------------------------------ | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Chat → location → project              | Native project assignment, recorded cwd, verified local root | Projects appear while chats are discovered                     | Keep missing/remote paths as historical locations; no project from an encoded directory name alone |
| Worktree → repository                  | Git common directory/worktree metadata                       | Group branch checkouts                                         | Same remote URL is only a possible clone match; submodules retain their own identity               |
| Project → scoped resources             | Native roots, scope and precedence rules                     | Show applicable instructions, skills, tools and notes together | Do not promote project-local content globally                                                      |
| Agent preset → skills/tools/notes      | Explicit supported definition fields                         | Review dependencies together                                   | Declaration is not installation, permission or actual use                                          |
| Skill → bundle/dependencies            | Complete directory tree and supported metadata               | Keep scripts/assets usable after sharing                       | Prose mentions are not mandatory dependencies; preserve relative paths                             |
| Chat → parent/fork/children            | Native lineage identifiers and creation type                 | Group related work                                             | Fork, subagent and common text prefix are different; absent lineage remains unknown                |
| Chat → files/tools used                | Completed structured events with paths/tool IDs              | Find the conversation behind a change                          | Proposed/declined operations and mentions do not prove a completed edit                            |
| Note → source                          | Recorded note/chat/message provenance                        | Explain and correct imported knowledge                         | A source reference does not establish truth or usefulness                                          |
| Several paths → one resource           | Verified physical target                                     | Recognize an existing shared skill/note                        | Equal content means equivalent versions, not common ownership                                      |
| Several frontends → one chat           | Native ID within the same owning store/environment           | Avoid CLI/IDE duplicates                                       | IDs in different stores are not globally unique; forks remain separate                             |
| Chat → historical code context         | Git metadata recorded at the time                            | Filter by branch/commit                                        | Current checkout is not historical evidence; a SHA does not imply authorship                       |
| Shared item → effective client variant | Scope/profile, native precedence and client policy           | Explain why a client sees a different version                  | Same MCP name/endpoint can use different accounts or permissions                                   |

## Relationships have time and scope

A chat can start in one folder, add another and later move. Retain a primary project plus explicit related locations, with observation times where available. A project can have multiple roots. Native project IDs are strong evidence within that source; they are not universal Hub IDs.

Treat a remote environment as part of path identity. `/workspace/shop` in two containers does not identify the same local folder. Do not resolve a remote recorded cwd against the host filesystem. Filesystem IDs can help recognize a local alias but are not portable permanent IDs across devices, restores or filesystems.

Separate clones should remain separate locations unless there is stronger evidence or a user-approved grouping. A folder rename needs a retained source identity, a verified move or a suggestion; a matching basename is insufficient. Preserve project IDs and user names through accepted moves.

## Facts, suggestions and unknowns

Automatically record explicit native references, supported declarations, verified Git relationships, physical aliases and completed events. Store the source field/event and version that justify each fact. “Found,” “configured,” “loaded” and “used” are distinct observations; a source may support only some of them.

Offer suggestions for equal names, equal remotes, copied content, paths mentioned in prose and inferred topics/tasks. Keep suggestions out of the required setup flow. Never label a recent conversation “the current task” or mark a task complete because the assistant stopped responding.

Do not infer that a client is active, installed or signed in merely because an old data directory exists. Do not infer that a native note belongs to one project when its configured directory is deliberately shared by several projects.

## Read coverage is part of every result

A catalog pass should retain an adapter version, source identity, selected categories, cursor/generation, successful coverage and errors. A complete scan means complete for that declared selection and supported contract, not every byte on the machine.

An empty result may mean no chats, a permission failure, an unsupported format, default API filtering or a partial page. Only the first is evidence of absence. Missing sources must never purge archived chats, remove project associations or trigger shared-content deletion.

For archives, distinguish “metadata found,” “native content preserved” and “search view built.” If only an API projection is available, label its coverage; do not call it an exact native backup. Keep raw events/exports or stable source snapshots when supported, then rebuild normalization and relationships after parser improvements.

## Keep the user's corrections small

Most users should see a project list, not the catalog rules. Provide only useful corrections:

- Rename or combine projects; move a chat to another project.
- Mark a location as unrelated; leave a missing folder in history.
- Choose whether a resource is shared or stays in its original scope.
- Inspect why an item was associated and remove a wrong association.

Retain explicit user corrections across rescans. A rejected suggestion should not return every time. Do not require users to tag each chat, declare every dependency or resolve low-value suggestions before syncing.
