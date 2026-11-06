# Beta.3 launch readiness

Version: `0.1.0-beta.3` · prepared 2026-11-06. Runtime source was verified at `40687b99c9e2dc39973ef6f9024aedb461f28095`; the final release commit and file hashes are recorded in the generated release manifest. Subsequent preparation changes are documentation only. This record does not invent private trial transcripts or independent user-adoption results.

## Evidence

| Check                                                 | State                | Evidence                                                                                                                                                                                                              |
| ----------------------------------------------------- | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Formatting, lint, architecture, types and tests       | Passed               | 345 tests locally, including the full Node 22 suite; no real client writes in fixtures.                                                                                                                               |
| Coverage                                              | Passed               | 93.67% lines, 85.80% branches, 91.75% functions.                                                                                                                                                                      |
| Package contents                                      | Passed               | 410 runtime/UI/documentation files; local state, credentials and synthetic fixtures excluded.                                                                                                                         |
| Fresh install, reinstall and uninstall                | Passed               | Disposable-prefix lifecycle passed with telemetry suppressed; data/settings preserved on reinstall, binaries removed on uninstall.                                                                                    |
| Exact runtime remote checks                           | Passed               | Quality run 42260238671: all four Linux/macOS × Node 22.13/24 jobs green; secret scan 42260238619 green. The tagged release workflow verifies the final release commit separately.                                    |
| Public repository and private vulnerability reporting | Verified             | Public repository, default branch master; GitHub private vulnerability reporting enabled.                                                                                                                             |
| Browser UI and EN/RU guide                            | Passed               | Isolated desktop/narrow-layout checks, settings off/on, search/chat/context export into a local TLS collector; website events intercepted locally. Production HTTP verification passed all 60 routes/assets/settings. |
| Real Codex → DeepSeek Harness scenario                | Maintainer confirmed | On 2026-11-06 the maintainer reported item 1 of the release checklist passed, including memory, continuation, external edit/conflict and recovery. Raw private evidence is not included here.                         |
| PostHog event visibility                              | Maintainer confirmed | On 2026-11-06 the maintainer reported seeing the events. Relay region US matches the project; fictional test signals are marked and excluded with is_test=false.                                                      |
| Tagged artifacts and published prerelease             | Release step         | The release workflow verifies the tag, builds archives and checksums and creates a draft. Verify downloaded files and manifest before publishing.                                                                     |
| Actual OS sign-in startup                             | Not tested           | Worker/definition checks passed; an actual sign-out/sign-in is a separate manual check and remains disclosed as unverified.                                                                                           |
| First five independent users                          | Not started          | No independent pilot or adoption/retention result is claimed.                                                                                                                                                         |
| HN/PH publication                                     | Not submitted        | Launch drafts exist; no public posts or invitations have been sent.                                                                                                                                                   |

## Scope and release boundary

This release includes the unpublished beta.2 archive/interface work and beta.3 analytics. Keep beta.2's tag/draft unchanged. Do not add features to fill the launch checklist. Publish the new beta.3 prerelease only after its workflow, downloaded checksums and exact-commit manifest pass.

Installation/update/removal documentation separates stopping the detached worker, removing reviewed login startup, restoring intended native state and uninstalling the package. Uninstall alone does not restore client settings or delete archives. The maintainer's current global installation and running Hub are not changed by release preparation.

## Pilot decision

After release, recruit a small independent pilot and observe repeat use for two weeks. The proposed continuation gate remains at least five activated testers, three returning on separate days without reminders, and a repeated task they say Hub replaces. These are operating choices, not observed market numbers. Keep private participant evidence out of the public repository.
