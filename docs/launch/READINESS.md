# Beta.5 launch readiness

Version: `0.1.0-beta.5` · prepared 2026-11-06. Runtime fix verified at `e6ea67ef608c119d95763017f5046e80029e90c8`. This release adds version and documentation metadata to that tested runtime; its exact commit and file hashes are recorded in the generated release manifest.

## Evidence

| Check                                      | State                                              | Evidence                                                                                                                                                                                                                                  |
| ------------------------------------------ | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Runtime static checks and tests            | Passed                                             | Quality run 42273575328: all four Linux/macOS × Node 22.13/24 combinations passed; 349 tests locally. Secret scan 42273575382 passed.                                                                                                     |
| Memory race reproduction and regressions   | Passed                                             | Before the fix, 4 of 32 Node 22 contention trials failed on a managed staging file. After the fix, all 32 trials passed. Two deterministic held-lock regressions fail before and pass after the fix; foreign files still fail validation. |
| Coverage                                   | Passed                                             | Local runtime coverage: 93.90% lines, 86.11% branches, 91.76% functions.                                                                                                                                                                  |
| Package and installation lifecycle         | Passed on runtime baseline; repeated for candidate | 410 allowed runtime/UI/documentation files; temporary-prefix install, reinstall and uninstall passed. No real client setup is used by fixtures.                                                                                           |
| Final tag, archives and publication        | Release step                                       | The new tagged workflow must pass. Download its assets, verify SHA256SUMS and compare release.json with the tag before publishing the prerelease.                                                                                         |
| Browser UI and guide                       | Existing feature verification                      | The earlier isolated local Hub/UI analytics pass remains applicable. The current 80-route EN/RU guide passed 33 tests, Safari desktop/390px checks and exact-byte production HTTP checks.                                                 |
| Real Codex → DeepSeek Harness task         | Maintainer confirmed on earlier feature basis      | The maintainer reported memory, continuation, external-edit conflict and recovery success on 2026-11-06. A new beta.5 manual trial is not claimed.                                                                                        |
| PostHog visibility                         | Maintainer confirmed                               | The maintainer reported seeing events on 2026-11-06. Test events are excluded from production reports.                                                                                                                                    |
| Public repository and private reporting    | Previously verified                                | Public repository, master default branch and private vulnerability reporting enabled; release checks retain the existing secret scan.                                                                                                     |
| Actual OS sign-in startup                  | Not tested                                         | Definition/worker tests passed; a real sign-out/sign-in remains a separate manual check.                                                                                                                                                  |
| Independent pilot and public announcements | Not started                                        | No adoption, retention, HN/PH publication or independent user result is claimed.                                                                                                                                                          |

## Scope and release boundary

Beta.5 includes the published beta.4 feature set plus the automatic memory lock-order fix. Keep all existing tags and published assets unchanged. The obsolete unpublished beta.2 draft was deleted at the maintainer’s request; do not recreate it. Publish only the new candidate after its checks and artifact verification pass.

Version preparation does not update the maintainer’s installed CLI or running Hub. Updating a live installation requires stopping its updater/UI and following the documented install/restart workflow. Uninstall alone neither restores client configuration nor deletes archives.

## Pilot decision

After release, invite a small independent pilot and observe repeat use for two weeks. The proposed gate remains five activated testers, three returning on separate days without reminders, and a repeated task they say Hub replaces. These are operating choices, not observed market results. Keep participant evidence private.
