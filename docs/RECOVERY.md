# Original-state recovery

`undo [run-id]` returns to immediately before one recorded setup workflow. `restore <backup-id>` undoes one sync or content stage. `reset` returns recorded client configurations and the complete hub directory to their first saved state, even after several syncs. Every operation starts with a plan. Undo asks for confirmation in a terminal; explicit dry runs and noninteractive calls remain read-only.

```sh
ahub reset --dry-run
```

Review every file and the baseline scope. The command prints an exact `reset --apply --expect <revision>` command. Reset requires that reviewed revision; changed inputs stop it. No reset is performed by a dry run.

## Quick workflow recovery

Every applied shared Hub quick setup or project connection records a private snapshot under `<AGENT_HUB_HOME>.recovery/runs/<run-id>/`. The Hub tree is captured before the workflow; first-touch external originals and guarded write journals are collected as stages run. The entire staged workflow holds one reentrant Hub lock. Independent clients do not honor that lock, so input checks still apply at every stage.

```sh
ahub undo
ahub undo <run-id>
```

Review the plan and confirm in a terminal, or use the emitted `--apply --expect` command. Undo restores the pre-run state and archives current data through the recovery engine. It handles completed stages from partially failed workflows. Later changes to the Hub or touched client paths block undo, even if the changes were made by another Hub operation. Review an individual restore or first-baseline reset when later work must be retained. Undo never silently drops later knowledge. A workflow interrupted before its final metadata was recorded cannot be undone automatically; preserve its recovery data and inspect the normal reset preview.

Completed undo invalidates pending checkpoint authority. First-baseline originals remain separate and available; their journals recognize the restored Hub-owned state. Snapshots include the complete Hub and affected personal files, are not encrypted, and are retained without automatic pruning. No-op applies also retain a workflow snapshot. Keep recovery storage private and account for its disk usage.

`ahub project disconnect <id>` is a separate reviewed content operation. It disconnects all checkouts of that project, disables its policy and removes pending session tokens while retaining knowledge, source history, repository files and shared hook handlers. Reconnect verifies identity and reuses the project ID. Disconnect does not uninstall fixed-workspace Memory MCP configuration; that service refuses the disconnected binding until it is reconnected.

`reset` always uses the first baseline, including when it predates the current run. On a new Hub it can return Hub to absence and restore external originals. Hooks and MCP may edit the same DSH profile: both writers share the first-touch owner and coordinate expected hashes so Hub's own later writes are recognized. Later independent edits still block recovery by default.

## What is saved

Before the first managed write, the hub records an immutable baseline in `<AGENT_HUB_HOME>.recovery/baseline/`. The complete initial hub tree includes its existing `.git`, `.env`, instructions, memory, skills and unrelated files. Client configuration originals are saved separately. New client locations/profiles receive their own first-touch original without replacing older records. Directories are private (700); payloads and metadata are private (600). A local `.gitignore` excludes recovery contents from a parent Git repository.

Recovery storage is outside the hub so the hub can return to absence. Keep it: deleting it removes the recorded originals. It can contain credentials. Do not publish or upload it. Recovery snapshots are not encrypted.

There are two honest baseline scopes:

- `before-hub-creation`: the hub did not exist before this version created it. Reset archives the generated hub and returns its path to absence.
- `existing-hub-checkpoint`: the hub already existed when the first baseline was recorded. Reset restores that checkpoint, not an unknown state before older releases or prototype scripts ran.

A missing baseline produces an error rather than capturing the current state and pretending it was the original. Earlier history without backups cannot be reconstructed.

## Current data is preserved

Reset archives the current hub and changing client files under `<AGENT_HUB_HOME>.recovery/archives/reset-…/` before restoring originals. Data created after setup is retained there. The original baseline is not consumed. Newly created client files return to absence; originally absent parent directories are removed only when empty, preserving any new user files; existing client symlinks keep their bindings. Ordinary external directories referenced by hub symlinks are not traversed or reset. Known external targets of managed hub configuration symlinks are recorded separately.

Unrelated files captured inside the hub are part of its directory reset. The archive may therefore contain later user work. Review the whole plan and keep the archive until satisfied. Reset does not uninstall the CLI, erase npm caches or reverse changes to remote providers.

## External changes

Later client edits or mode changes block reset by default. To explicitly preserve those current files in the archive and then restore their originals, review another plan:

```sh
ahub reset --archive-changes --dry-run
```

This is a whole-file restore, not a merge. A repointed symlink remains blocked even with `--archive-changes`; resolve the binding manually. Baseline corruption or a private-storage symlink also stops recovery before client writes.

## Interrupted operations and locks

A flushed per-file write-intent journal records the before/after hashes before managed writes. After a killed process, reset can recognize either side of an interrupted write instead of assuming that a multi-file operation completed. An external operation lock survives hub-directory moves; the inner `state/sync.lock` still coordinates older processes.

If a process left locks behind, inspect their owners and review:

```sh
ahub reset --recover-lock --dry-run
```

The option never removes a lock whose PID is alive, whose ownership is unknown or whose contents changed. The copied apply command includes the recovery option. A live process must be stopped normally. Do not run mixed versions against the same hub during reset.

## Failure handling and limits

Client writes use guarded replacements with compensating rollback. Directory installation failures attempt to restore both the archived hub and the previous client files. If rollback cannot finish, the error identifies the retained archive for manual recovery. Recovery also works when `hub.yaml` is corrupt or the active hub directory has been removed, because it uses its external manifest rather than current settings.

The tests cover SIGKILL during sync and reset plus injected ENOSPC/rename failures, not power loss or every filesystem failure. Directory operations and several file writes are not a database transaction. An abrupt reset-process failure, disk loss, a failed rollback or a race with another application can still require manual recovery from the retained baseline/archive. File modes and symlink bindings are recorded; inode identities, hardlink relationships, ACLs and extended attributes are not guaranteed. Hub-root directory symlinks, special files and externally stored Git metadata cannot provide the same complete-directory recovery contract. `init --no-git` avoids mutating an existing Git worktree's external metadata.

Before resetting a production hub, stop its UI and affected clients, keep an independent backup, review the dry run and retain the recovery directory.

## Skills, context and project artifacts

Content operations retain `content-…` backups, supported by the same `restore <id>` CLI. First-touch originals of external skill directories, individual symlinks and repository/context files are recorded in the private recovery `artifacts/` store. Reset validates these payloads and includes them in its plan, archives and compensating rollback. Full-file restoration can replace later project notes; external edits require explicit archiving. Repointed links remain blocked.

Directory replacement has a brief rename gap. Artifact intent permits recorded before/after states during interrupted writes; it does not establish power-loss durability. Symlink permission bits are normalized for comparison across platforms, while target bindings, regular file modes and directory contents are checked. See [CONTENT.md](CONTENT.md) for the content contract.

Directory-tree snapshots retain the recorded modes of nested links. On macOS, copying now preserves those link modes even under a restrictive umask, without following the link or changing its target permissions. Existing snapshot hashes and originals remain valid.
