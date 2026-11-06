# Preparing a beta release

The earlier `v0.1.0-beta.2` tag/draft and failed `v0.1.0-beta.3` tag remain frozen. Beta.4 fixes the background metadata race exposed by beta.3 release CI and includes its default-on analytics. The maintainer confirmed the Codex → DSH trial, conflict/recovery extension and PostHog visibility on the beta.3 feature basis on 2026-11-06; see the [readiness record](launch/READINESS.md). This is manual maintainer evidence; a separate beta.4 manual trial is not claimed.

The candidate version is **0.1.0-beta.4**. It uses a source ZIP and a standalone npm tarball. The earlier published **0.1.0-beta.1** archive does not contain the current chat archive, interface and context-handoff features. Use the current source checkout while this candidate is being prepared; candidate assets become available only after publication. `private: true` deliberately prevents accidental registry publication; it does not prevent installing the reviewed local tarball. The npm registry name and registry publication are deferred. No push, tag, GitHub Release or deployment is performed by the preparation commands.

## Install the candidate

Requires Node.js 22.13+ and npm. Unpack the source ZIP, enter its directory and run:

```sh
npm ci
npm run install:global
ahub --version
ahub quick
```

Alternatively install the prebuilt tarball from the same candidate:

```sh
npm install --global ./agent-hub-0.1.0-beta.4.tgz
ahub --version
```

The executable must report `0.1.0-beta.4`. Both installation methods may download locked dependencies from npm; this is not an offline bundle. Use a user-writable npm prefix.

## Update or uninstall

Before replacing the installed package, close its UI, keep affected clients idle and stop the detached archive updater:

```sh
ahub history watch --stop
ahub history status
```

Wait until status reports that the worker is no longer running. Stop retains saved chats and the source selection. It does not remove login startup files.

For an update at the same Node and package paths, install the chosen source revision or tarball again, check the version, review `ahub quick --dry-run` and restart affected clients. Restart archive updates explicitly when ready. If the Node/package paths will change, remove the old login startup first, then review its setup again using the new installation.

If login startup was enabled, preview its removal before uninstalling:

```sh
ahub history watch --login off
```

Apply only the exact command printed by that preview. Removal affects the next user-session startup; stopping the current worker is separate. Edited or foreign startup files remain blocked for review rather than being deleted. Preserve them and resolve the reported conflict before removing their runtime.

Uninstalling does not restore generated client launchers, hooks or shared settings. To leave clients independent of Hub, review [recovery](RECOVERY.md) while the CLI is still installed. Reset archives current Hub data and restores the recorded first baseline; it is not an archive deletion command. Close affected clients, inspect the full preview and apply only its emitted command if that is the intended outcome. Keep the recovery directory.

```sh
ahub reset --dry-run
# Apply the reviewed recovery command only if restoring the baseline is intended.
npm uninstall --global agent-hub
```

Keeping Hub data without resetting is possible, but any remaining client launcher or hook still points at the removed package and cannot run until it is restored or deliberately reconfigured. Package removal does not erase the Hub, recovery archives or native conversations.

## Verify the exact source

Use a clean checkout with a frozen commit and locked dependencies. Never include a personal Hub, client configuration, `.env`, logs, local handoff state or private research in a release or its Git history. The root local AGENTS/CLAUDE handoff files, `.agents/` and `docs/research/` are ignored; public contributor guidance is in CONTRIBUTING.md. Check ignored files before changing those rules.

```sh
npm ci
npm run check
npm run test:coverage
npm run package:check
npm run install:check
npm audit --omit=dev --audit-level=moderate
npm audit
npm run release:prepare
```

Use Gitleaks 8.24.3 with `gitleaks git . --config .gitleaks.toml --redact --log-opts=--all` for the history scan. The configuration extends the default rules and allows only the documented synthetic QA token in its fixture file.

The full audit includes development tooling; investigate findings separately from the production audit. Do not force incompatible dependency downgrades or hide results. Scan all reachable Git history and the final working tree with a pinned secret scanner, redact reports and review findings. A clean scanner report does not prove the absence of every secret or personal detail. Never rewrite shared history automatically; credential rotation and coordinated cleanup are separate maintainer actions if anything real is found.

`release:prepare` refuses a dirty checkout, builds the CLI, packs the compiled runtime and UI, and archives tracked source from HEAD. Outputs are under `.tmp/release/0.1.0-beta.4/`: the installable `.tgz`, source `.zip`, `SHA256SUMS` and `release.json` with version, exact commit, Node requirement and file hashes. Verify the checksums after copying artifacts. GitHub Actions runs tests once on each macOS/Linux and Node 22.13/24 combination. Static checks, coverage and the production audit run on Linux/Node 22.13; package/installer checks run on Linux/Node 22.13 and macOS/Node 24. Ordinary branch/PR validation does not prepare release archives. A local run does not establish remote CI success.

## Public release gates

- Green remote CI for the exact release commit, including package and actual installer checks.
- A dedicated browser pass over the local UI and English/Russian guide, desktop and narrow layouts, keyboard navigation, command copying and language switching.
- A real-client task in at least two supported clients: restart/activation, memory retrieval and capture, external-change conflict handling and recovery. Useful knowledge must be inspected, not inferred from a checkpoint counter.
- Public repository visibility and private vulnerability reporting configured by the maintainer; SECURITY.md must have a working private reporting route.
- CHANGELOG.md reviewed, version and shrinkwrap aligned, artifacts/checksums attached to the intended prerelease, and known beta limits stated.
- The separate site references this exact core commit, refreshed documentation and GitHub source/release links. Domain/hosting and deployment remain maintainer-managed.

These gates remain open until evidence is recorded. Preparation is not approval to publish. If files change, cut a new commit, repeat the affected checks and regenerate every artifact and site reference before publishing.

## GitHub release workflow

The release workflow runs on version-tag pushes or a manual dispatch with an existing tag. It reuses the Quality workflow at that exact tag, verifies the version/checkout and scans full history. Tests run on all four platform/runtime combinations; coverage/static/audit checks run once, and package/installer checks cover both operating systems. Only the primary job prepares the release artifact. Tag pushes do not also start standalone Quality or Secret scan runs. Secret scanning still covers branch pushes and pull requests. Only after every job passes does it create a **draft** GitHub Release with changelog notes, package/source archives, checksums and the exact-commit manifest. Beta versions are marked prerelease. It never publishes to npm or deploys the website.

Run the following only from the reviewed, sanitized publication repository when ready to create a GitHub draft. The remote must point at the intended GitHub repository, and the tagged commit must already be available there:

```sh
git tag -a v0.1.0-beta.4 -m "Agent Hub 0.1.0-beta.4"
git push origin v0.1.0-beta.4
```

To retry, open Actions → Prepare GitHub release → Run workflow and enter the existing version tag. A rerun may refresh assets and notes on the draft; it refuses to modify an already published release. Downloaded artifacts are checksum-verified and their manifest commit is compared to the tag again before upload. No tag or release is created by local preparation.

After the real-client and browser gates pass, review the draft and publish it manually in GitHub. The website links to the GitHub repository and Releases page; it does not host its own source ZIP. GitHub visibility, private vulnerability reporting and the first source push remain explicit maintainer steps.
