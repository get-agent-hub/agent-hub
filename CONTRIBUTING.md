# Contributing

Use Node.js 22.13+ and install the locked dependencies with `npm ci`.

```sh
npm run check          # Prettier, ESLint, typecheck, build and tests
npm run test:coverage  # Runtime coverage; minimum 80% lines/functions, 75% branches
npm run package:check  # Verify all required UI assets and the package allowlist
npm run qa:ui          # Manual UI fixture; no production client writes
```

`npm run format` applies the shared formatting rules. `npm run lint:fix` applies safe ESLint fixes. The flat ESLint configuration checks TypeScript and JavaScript, catches floating TypeScript promises, rejects explicit `any` and prevents core modules from importing CLI/UI code. `.editorconfig` and `.gitattributes` standardize whitespace and line endings. CI runs the same checks on macOS/Linux with Node 22.13 and 24. CI configuration is not evidence that those remote jobs have already passed.

## Structure

- `src/commands`: thin CLI presentation and process lifecycle.
- `src/core`: launch definitions, import/sync/restore planning, guarded file operations and domain services.
- `src/adapters`: client formats, client-local policy and location discovery.
- `src/integrations`: optional provider presets; generic health transport stays in core.
- `src/ui`: HTTP interface, safe public projections and document reading.
- `ui/app`: browser orchestration, HTML primitives and connection-status views; no bundler.
- `tests`: Node's test runner with isolated temporary hubs and independent MCP fixtures.

Prefer small functions with one responsibility and explicit inputs over speculative interfaces or class hierarchies. Add shared helpers when two real callers need the same behavior. Keep runtime schema validation at file/HTTP boundaries. Do not let parser exceptions or server logs enter user-facing reports.

Use `writeChecked` for a single guarded replacement, `writeTransaction` for related replacements with rollback, capture a baseline/write intent before mutation, and use `withHubLock` for an operation that changes hub configuration. These are advisory, compensating operations: several files cannot be replaced simultaneously, and a process or machine crash can leave recovery work. Never describe them as crash-safe transactions.

Regression tests should demonstrate observable failures: stale plans, interrupted writes, format preservation, secret redaction or cleanup. Avoid testing implementation details or adding assertions just to improve coverage numbers. Runtime tests must use injected clients or explicit path overrides; never change the real user's home or client files.

## Release checks

The npm package remains private until a public package name and version are selected. Publishing and pushing are explicit maintainer actions. The package allowlist excludes test fixtures, local state, QA reports and design mockups. Run the full checks from a clean checkout before cutting a release.

Production dependency audit must pass. Review development-tool advisories separately: do not force unrelated major-version changes or hide advisories with unexplained overrides. See `docs/CODE_REVIEW.md` for the audited baseline and known limitations.

Original-state recovery is described in [docs/RECOVERY.md](docs/RECOVERY.md). Fixtures that place a hub at the temporary root must also remove its sibling recovery directory during cleanup.
