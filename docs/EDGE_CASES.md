# Edge-case audit and recovery validation

This audit added original-state recovery and regression checks beyond ordinary sync/restore. The tests use isolated hubs and clients; production configurations were not reset.

## Newly exercised cases

| Case                                                          | Expected behavior / verification                                                                 |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Several syncs, including different clients                    | Immutable first checkpoint survives; one reset restores all recorded originals                   |
| Ordinary restore after a later sync                           | Refuses a stale ownership state rather than guessing backup order                                |
| A newly created hub and Git directory                         | Reset archives the complete generated hub and returns the active path to absence                 |
| Existing hub with private data and binary files               | Exact recorded tree fingerprint is restored; current tree remains archived                       |
| Client config originally absent                               | Created file is removed; newly created parent directories are removed only when empty            |
| New user files in created directories                         | Kept in place; directory cleanup does not recurse through them                                   |
| Client edited or chmodded after sync                          | Blocks reset; explicit archive-changes preserves the current file before full-file restore       |
| Client edit, mode change or new hub file after preview        | Reviewed reset revision becomes stale and apply stops                                            |
| Existing config symlink                                       | Target bytes/mode are restored and the original binding is retained                              |
| Repointed client symlink                                      | Blocks even with archive-changes                                                                 |
| External directory symlink inside hub                         | Pointer is preserved; arbitrary external contents are not followed or reverted                   |
| Corrupt baseline payload                                      | Integrity check stops before current data changes                                                |
| Corrupt hub.yaml or deleted active hub                        | Recovery uses the external baseline rather than current hub settings                             |
| Process SIGKILL after the first sync replacement              | Intent journal accepts partial before/after state; dead locks require explicit recovery          |
| Process SIGKILL just after moving the active hub during reset | Repeated reset can complete from the external baseline, for both existing and newly created hubs |
| Live or unrecognized lock owner                               | Never removed by automatic reset recovery                                                        |
| Reset installation rename fails                               | Previously changed clients and active hub are rolled back                                        |
| Reset rollback also fails                                     | Explicit manual-review error; baseline and archive retained for another attempt                  |
| ENOSPC while capturing originals                              | Stops before managed writes; incomplete baseline is not committed and retry remains recoverable  |
| ENOSPC while archiving current clients                        | Stops before client/hub reset writes                                                             |
| A newly selected DSH profile                                  | Its first-touch original is added without replacing earlier baseline records                     |
| Symlinked or foreign pre-existing recovery storage            | Rejected without overwriting foreign data                                                        |
| Two clients resolve to one configuration file                 | Blocked during sync preview                                                                      |
| Package/Node path changes                                     | Marked hub launchers are skipped during re-import, avoiding nested launchers                     |
| MCP name starts with a dash                                   | Copied replacement commands use equals-form option values and execute successfully               |
| CLI reset outside the project cwd                             | Exact copied revision-guarded command works with overridden client locations                     |

## Important findings

The old restore command covered a single sync, not the original state across the whole history. A baseline external to the hub, immutable original payloads, a write-intent journal and the reset command now cover that use case.

Testing exposed canonical-path differences on macOS (`/var` versus `/private/var`), copying of readonly directories, ambiguous lock-owner handling and cleanup after a process dies after completing the data restoration. These cases are covered by regression tests.

No backup can reconstruct unknown historical state. On an existing installation with no baseline, reset reports that fact and does not create a misleading snapshot during dry run. The first later managed write establishes an explicitly labeled existing-hub checkpoint. Before a fresh hub is created, the baseline records the pre-creation state.

## Still not established

- Real power loss, disk/controller corruption or network-filesystem failure. Process-kill and injected I/O failures do not establish full crash durability.
- Atomic isolation from third-party applications in the final check-to-rename interval. Current-version hub processes share locks; external clients do not.
- Windows end-to-end process-tree handling, ACLs, native wrappers and filesystem semantics. Supported release targets remain macOS/Linux; the CI matrix has to run remotely.
- Preservation of inode identities, hardlink relationships, ACLs, xattrs and every timestamp. Recovery checks file content, mode, directory structure and symlink bindings.
- Migration of an active hub/root recovery directory to another machine or path. Recorded target bindings and local credentials must be reviewed; this is not a portable cloud backup format.
- Reconstructing pre-prototype history without its original files. Existing checkpoints are labeled honestly.
- Full browser automation, interactive terminal behavior, API-level permissions for every MCP and provider-specific side effects. Doctor initialization/tools discovery do not execute tools.
- Large-hub performance benchmarks. Tree hashing is streaming, but complete baselines and archives require disk space; retain independent backups.

See [RECOVERY.md](RECOVERY.md) for the exact reset contract, flags and retained archives.

## Validation result

The full quality gate passed with **86 tests**. All 86 also passed on Node **22.13.0**. Runtime coverage was **88.66% lines**, **83.92% branches** and **86.68% functions**, above the configured thresholds. The package allowlist check passed. A real `reset --dry-run` correctly reported the absence of a historical baseline; hashes of all nine monitored working hub/client files and the recovery-directory inventory were unchanged.
