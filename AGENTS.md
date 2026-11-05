# Working on Agent Hub

Read [CONTRIBUTING.md](CONTRIBUTING.md) and [the code guide](docs/CODE_GUIDE.md) before changing code. Read existing behavior tests and relevant feature documentation too.

- Keep CLI, HTTP, MCP and worker entry points separate from core operations. Core must not import presentation code or print terminal output.
- Put operations in their owning subsystem under `src/core`, client formats in `src/adapters`, stable adapter contracts in `src/contracts`, and reusable infrastructure in `src/shared`.
- Use functions and narrow explicit inputs. Introduce an interface at a real boundary or for an existing alternative implementation. Avoid generic managers, plugin frameworks and empty architecture layers.
- Preserve CLI/HTTP contracts, native fields, scope, secret handling, locks, reviewed revisions, recovery and cancellation when refactoring. Update worker/resource paths, package checks and documentation links after file moves.
- Prefer files of 100–250 lines and functions with one clear responsibility. ESLint enforces 400 lines per runtime module/script, 250 nonblank/noncomment lines per TypeScript function and 800 lines per test module. Split by behavior, not numbered fragments. The old browser shell has one 765-line exception until the separate UI rebuild.
- Do not add exceptions or raise limits just to pass checks. Explain a necessary architecture change in the code guide and its review.
- Keep all source observations until scope, precedence and physical aliases are resolved. Equal names alone do not identify the same resource.
- Use existing checked writes, locks and recovery. Do not bypass them with direct mutation paths or describe compensating rollback as a crash-safe transaction.
- Validate untrusted file, process and request data at boundaries. Keep credentials and transcript bodies out of public plans, logs and errors.
- Test in temporary homes with injected services. Never apply test setup to real clients. Add regressions for meaningful failure cases, not assertions that mirror extracted functions.
- Keep existing commands and UI behavior working during structural work. Apply feature slicing during the later browser rebuild; do not introduce a framework in an unrelated backend refactor.
- Run `npm run check`, `npm run test:coverage`, `npm run package:check` and `npm run install:check` for structural runtime changes. Report actual results and limitations. Publishing, pushing and release creation are separate actions.

The public package entry points are the CLI binaries. Internal `dist` paths are implementation details; update repository callers and package contents consistently when moving them.
