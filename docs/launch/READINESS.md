> The beta.2 checklist below records the frozen archive/UI candidate. Current source is beta.3 with analytics changes and needs its own exact-commit checks and real-client trial before release.

# Beta.2 launch readiness

Candidate: `0.1.0-beta.2` · prepared 2026-11-06. The exact frozen commit and archive hashes belong in the release manifest. This checklist is not a claim that publication or a user pilot has happened.

## Scope freeze

Launch tests two existing jobs: find an earlier decision and continue a task in another supported client. Project-page development and general bidirectional reconciliation remain deferred. Fix installation, correctness and data-preservation blockers; do not add features to fill a launch checklist.

## Evidence

| Check                                                | State                         | Evidence or next action                                                                                                                                           |
| ---------------------------------------------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Core formatting, lint, architecture, types and tests | Passed locally                | 339 tests; isolated profiles, no production client writes.                                                                                                        |
| Coverage                                             | Passed locally                | 93.76% lines, 85.80% branches, 91.90% functions.                                                                                                                  |
| Package contents                                     | Passed locally                | 399 files; runtime/UI/docs included, fixtures and local state excluded.                                                                                           |
| Fresh install, reinstall and uninstall               | Passed locally                | Actual disposable-prefix lifecycle preserves saved/native bytes on reinstall; uninstall removes binaries and retains data.                                        |
| Published beta.1 to beta.2 upgrade                   | Passed locally                | Published old SHA256 verified; package replacement preserves Hub/recovery/native bytes, modes and links. New archive/handoff/background append passes.            |
| Production dependency audit and secret scans         | Passed; dev advisory recorded | Production audit: zero. Tree and full reachable Git history scans pass. Full audit has 10 moderate dev-package entries from minimatch; no incompatible force fix. |
| Browser and demo                                     | Passed locally                | Real 70-second demo; EN/RU task pages, MP4 playback, mobile layout and language anchors checked in an isolated browser.                                           |
| Exact-commit remote checks and draft assets          | Pending                       | Freeze the source; let the release workflow verify the tag and attach checksummed assets to a draft.                                                              |
| Real Codex + DeepSeek Harness usefulness             | Maintainer trial pending      | Follow [the real-client trial](REAL_CLIENT_TRIAL.md). Record actual saved/retrieved knowledge and continuation, not counters.                                     |
| External-edit conflict and recovery                  | Maintainer trial pending      | Complete the trial's conflict/recovery extension before closing the real-client release gate.                                                                     |
| Actual OS sign-in startup                            | Not tested                    | Direct worker/file tests passed earlier; a real logout/login remains a separate manual OS check.                                                                  |
| First five independent users                         | Not started                   | Use [the pilot](PILOT.md); participant results stay outside this repository.                                                                                      |
| HN/PH publication                                    | Not submitted                 | Review the drafts after release gates pass; no invitations or posts have been sent.                                                                               |

## Release boundary

The published beta.1 archive predates the archive/UI/handoff shown in current source. Do not reuse that tag or send launch visitors to its download while demonstrating beta.2 features. Keep beta.2 as a draft until the exact-commit automated checks and required real-client trial are recorded. See [release gates](../RELEASE.md#public-release-gates).

Installation/update/removal documentation now separates stopping the detached worker, removing reviewed login startup, restoring intended native state and uninstalling the package. Uninstall alone does not restore client settings or delete archives.

## Pilot decision

Cap preparation at a few days and observation at two weeks. Proposed continuation gate: at least five activated independent testers, three returning on separate days without usage reminders, and a repeated task they say Hub replaces. These are operating choices, not market statistics. If activated users do not return after blockers are addressed, keep a personal/open-source utility or maintenance-only project and end feature expansion. Failed recruitment leaves demand unknown; it does not justify unlimited development.
