# Public release code review

Review scope: all tracked TypeScript, browser JavaScript, fixtures, CLI commands, configuration and documentation. This pass includes refactoring and regression coverage, not a claim that every possible defect is eliminated.

## Findings addressed

| Finding                                                                   | Change                                                                                              |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Node 20 declared despite Commander requiring Node 22                      | Runtime minimum aligned to 22.13; Node types match that baseline                                    |
| TypeScript 7 incompatible with current typescript-eslint peer range       | Supported TypeScript 6.0 selected without forcing peer dependencies                                 |
| Unformatted source and no automated quality gate                          | Prettier, ESLint, strict compiler checks, editor settings and CI                                    |
| Core imported CLI implementation; shared infrastructure lived in sync     | Launch/status services and focused errors, values, file-store, transactions, lock and shell modules |
| Import could leave credentials, registry and provenance partially updated | One interprocess lock, checked source/hub inputs and compensating rollback                          |
| Registry read errors could become an empty registry                       | Shared runtime schema and fail-closed configuration reads                                           |
| Dotenv parser lost multiline or escaped credentials                       | Preserving parser/writer with round-trip tests for quotes, escapes, newlines and Unicode            |
| Credentials inside URLs could remain in tracked registry                  | Extract credential-bearing URLs and arguments into `.env`; regression coverage                      |
| Import staged every hub file automatically                                | Import does not commit; initialization commits only its explicit setup files                        |
| Prototype-specific migration and takeover                                 | Removed implicit migration/ownership exceptions; normal reviewed import applies                     |
| Hardcoded n8n behavior in domain/UI                                       | Generic readiness configuration and generic UI labels, optional isolated preset                     |
| Copyable commands assumed a POSIX shell                                   | Central POSIX/PowerShell rendering with quoting tests                                               |
| DSH import and sync resolved profiles differently                         | Shared settings parser and profile resolver                                                         |
| Personal email/domain in design examples                                  | Replaced with example.com identities                                                                |
| UI runtime depended on design mockup assets                               | Self-contained runtime assets and package-content verification                                      |
| Duplicate fingerprint serialization and policies                          | Shared serialization and adapter-local policy definitions                                           |

The CLI and UI use the same domain services. Client-specific formats and platform opening/cleanup logic remain explicit integrations; those are necessary compatibility rules rather than user-specific assumptions. No user home, email, machine path or corporate host is compiled into the runtime.

## Validation baseline

The local quality gate covers formatting, lint, TypeScript, full integration/unit tests and package contents. Coverage reports include compiled runtime files, not fixture code. The local baseline is **54 passing tests**, **86.20% runtime lines**, **81.46% branches** and **84.68% functions**. The full CLI flow also runs from an unrelated working directory with all three client locations overridden. The complete suite also passed locally under Node **22.13.0**, the declared minimum. Later test runs are the authoritative result.

The production dependency audit reported **zero vulnerabilities**. The full development tree reported a moderate minimatch denial-of-service advisory propagated through ESLint tooling. The affected patterns are repository-controlled lint configuration, and those tools are excluded from the release runtime. No unsupported dependency override or forced downgrade was applied. Review upstream fixes before publishing; this advisory is not represented as resolved.

## Remaining limits

- macOS/Linux are supported targets. PowerShell command rendering is tested as text; Windows subprocess-tree cleanup, permissions and native client wrappers still need end-to-end verification. Windows is experimental.
- CI is configured for macOS/Linux and Node 22.13/24. Local macOS success does not establish remote CI success.
- File replacement is atomic per file and flushed before rename. Multi-file rollback cannot guarantee recovery after abrupt process or machine termination. External applications do not honor the hub lock; a narrow check-to-rename race remains.
- A crashed process can leave the lock file. Recovery is explicit after verifying that the owner has stopped; the application does not guess whether a reused PID is safe to ignore.
- Secret extraction uses conservative heuristics. Review imported definitions before tracking or sharing a hub. Already committed secrets require removal and rotation outside this tool.
- The dependency audit covers the lockfile, not user-configured executables or packages downloaded by external launchers.
- Readiness probes are optional unauthenticated HTTP checks. They do not execute tools or establish provider API permissions, and an ingress may obscure the actual service state.
- Interactive terminal prompts and desktop browser-opening behavior are not fully automated by the unit suite. Source-level browser helpers and HTTP boundaries are tested; this pass does not claim a full automated browser matrix.
- Instruction delivery, repository initialization and session indexing remain explicitly unimplemented.
- The npm name/version and release remain maintainer decisions; no package was published by this review.

## Follow-up: original-state recovery

A later audit added external baselines, a durable write-intent journal, `reset`, explicit stale-lock recovery and regression cases for interrupted sync/reset. See [EDGE_CASES.md](EDGE_CASES.md) and [RECOVERY.md](RECOVERY.md). These improve process-failure recovery; they do not establish database-style crash durability or remove the filesystem limits listed above.
