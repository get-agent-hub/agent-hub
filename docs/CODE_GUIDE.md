# Code structure and contribution rules

Agent Hub uses feature-oriented core modules and separate interfaces. A reader should be able to find an operation, understand its inputs and follow the modules that own it. Small files support that goal; a large number of layers does not.

## Where code belongs

```text
src/
  cli.ts                    CLI composition
  commands/                 arguments, terminal interaction and output
  ui/                       HTTP protocol, session and route handlers
  mcp/                      MCP protocol adapters
  workers/                  isolated process entry points
  adapters/                 native client readers, formats and policies
  integrations/             optional provider integration entry points
  contracts/                stable client and adapter data contracts
  shared/                   filesystem, paths, locks, hashing and infrastructure
  core/
    configuration/          Hub settings, registry and client content context
    mcp/                    definitions, collection, launching and synchronization
    skills/                 bundles, collection and delivery
    instructions/           scoped instruction projection
    memory/                 records, scoped sessions, discovery and automation
    projects/               discovery, registered memory bindings and views
    history/                native archive capture, persistent catalog and scoped retrieval
    setup/                  initialization and shared/project workflows
    recovery/               baselines, guarded plans, restore, reset and undo
    diagnostics/            checks, probes and classified results
    overview/               aggregate status and readiness queries
```

For MCP sync, start at `src/core/mcp/sync.ts`. Its `sync/` modules separate planning, target comparison, native projection, public output and application. For setup, start at `src/core/setup/quick.ts`; `quick/` separates guards, preview, planning, application and stages. Entry modules expose named operations, not every internal helper.

HTTP startup is in `src/ui/server.ts`. Headers, origin checks and error handling stay there; body parsing is in `protocol.ts`. Each `routes/` file owns one API area and its previews/jobs. `session.ts` owns selection and shared mutation state. Project switches invalidate pending previews across route groups. Server shutdown stops its jobs.

The browser lives in `ui/app` with native JavaScript modules and no bundler. Historical `ui/mockups` files are design references, not runtime modules or package assets.

## Dependencies

Shared infrastructure can use shared code and stable contracts; contracts cannot import features. Core can use other core operations and existing adapter/integration boundaries, but never CLI, HTTP, MCP transport or worker entry points. Core cannot import terminal prompt/output helpers or call `console`.

Client adapters can use shared contracts/infrastructure and existing configuration/MCP format helpers. They cannot call setup, memory or recovery workflows. Accept an adapter or operation context at actual testable boundaries rather than adding global state.

CLI commands compose core operations and client discovery; only the UI launcher imports HTTP. HTTP query projections can read adapters, but mutation behavior belongs in core. MCP transports and workers call core within their configured scope. Browser modules import only local browser modules.

Do not introduce a dependency merely to reach a helper. Move infrastructure down or move orchestration to the operation that owns both dependencies. Keep type-only dependencies explicit. Runtime import cycles are rejected.

`npm run check:architecture` resolves actual module paths and checks static imports, re-exports and literal dynamic imports. Deep `../../` spelling cannot bypass a rule. Nonliteral module loaders require architectural review; they are not an escape hatch. The checker does not infer business correctness from names.

## Responsibilities and abstractions

A planner describes changes and guards; apply validates and performs them; a public projection decides what is safe to return. A parser does not repair or write its input. An HTTP handler translates requests and responses rather than editing native files itself.

Prefer functions, named data types and explicit collaborators. Interfaces belong at client/storage/process boundaries or real alternatives. Avoid one-implementation class hierarchies, generic repositories, service locators and event buses introduced only to connect extracted files.

Do not split one operation into one-line files or numbered fragments. Helpers with one caller normally stay private. Share code when actual callers need the same semantics; similar-looking guards with different consumption/recovery rules may remain separate. Avoid barrels that expose every subsystem internal.

Centralize bundle resolution: `src/shared/runtime.ts` identifies the CLI independently of a feature's directory. `scripts/build.mjs` cleans the repository's `dist` before compiling, so renamed modules cannot survive as stale runnable package files.

## Size and readability

Aim for 100–250 lines per file and a function explainable in one sentence. Around 80 lines is a useful point to reconsider responsibilities, not a reason to scatter one algorithm.

Automated ceilings are 400 lines per TypeScript/runtime JavaScript module or maintenance script, 250 nonblank/noncomment lines per TypeScript function and 800 lines per test module. The function ceiling is an upper guard, not a preferred size. Tests can be longer because readable scenarios include setup, actions and assertions.

Every browser JavaScript module follows the same 400-line ceiling, including `app.js`. CSS is split into tokens, shell, primitives, resource representations, history, dialogs and responsive rules. Historical mockups are outside the runtime.

Use descriptive subsystem names. Avoid `utils`, `helpers`, `manager` or `service` modules that accumulate unrelated behavior. Comment constraints, ownership and non-obvious decisions rather than restating code. Remove obsolete numbered extraction comments.

## Contracts to preserve

- CLI/JSON and HTTP shapes, native fields and selection scopes.
- Complete skill bundles, client-only settings and distinct source copies.
- Reviewed revisions, single-use/expiry rules, private values and scope-change invalidation.
- Locks, baselines, intent records, partial outcomes and later-edit-safe recovery.
- Cancellation, subprocess cleanup, bounded reads/results and truthful incomplete coverage.

Compensating filesystem recovery is not a multi-file power-loss-safe transaction. Names, timestamps and paths alone do not establish cross-store identity. Configuration presence does not establish activation or backend readiness.

Do not import sign-ins or widen access as part of cleanup. Public failures must not expose raw parser errors, subprocess logs, credentials or transcript bodies.

## Tests and checks

Use temporary profiles, injected services and independent protocol fixtures. Shared test setup belongs in `tests/helpers` when multiple suites need it; assertions stay with their owning behavior. Discovery suites separate source reading, grouping and HTTP/jobs while retaining the same scenarios.

Test observable failures: lost data, stale authority, wrong scope, incomplete reads, unsafe recovery or private values leaking. Moving a function does not justify tests of private calls. Architecture rules have negative fixtures proving prohibited dependencies and cycles are rejected.

```sh
npm run check              # Format, lint, architecture, types, clean build and tests
npm run test:coverage      # At least 80% lines/functions and 75% branches
npm run package:check      # Required assets/modules and no stale flat core output
npm run install:check      # Actual install into a temporary prefix
```

For HTTP changes, exercise the synthetic browser fixture too. A fixture is not a real-client usefulness trial. New dependencies need a concrete capability and runtime/package-cost review; these structure checks add no production dependency.

## Browser slices

Use app composition → pages → user-action features → entities → shared UI/infrastructure. A slice exposes a small named API; callers do not reach into another slice's private model/UI. Dependencies point downward; same-layer slices do not import each other's implementation.

Create only layers with actual code. Overview, All data and Projects are pages; connecting a source and resolving a conflict are features; source/resource/project representations are entities. UI primitives and transport helpers are shared. Business operations and authority remain in backend core. The architecture check enforces downward imports and rejects imports across feature/page/entity slices. Shared primitives may compose other shared primitives. No framework or empty layer is required.

The browser shell composes three main destinations: Overview, All data and Projects. Sources & settings is secondary. `pages` owns the overview, resource views and source settings; `features` owns guarded setup/import/sync, diagnostics, memory, archive and discovery actions; `entities` owns transcript, project and health representations; `shared` owns escaping, links, route parsing, disclosure/focus preservation and shell copy. `styles` separates visual responsibilities. Small slices expose named exports directly; there are no forwarding barrels. Existing resource hashes are accepted as aliases.

`src/ui/assets.ts` is an explicit asset allowlist. Moving a browser module requires updating its URL, package/install checks and local imports. No arbitrary directory serving or remote runtime assets are permitted.

## Archive background updates

`core/history/background.ts` owns selected-source policy and safe status, `background-state.ts` owns private control metadata and the process lease, and `background-runner.ts` runs sequential checked captures with independent cooperative cancellation. `background-process.ts` starts the bundled worker and requests its stop for both CLI and HTTP callers. `workers/history.ts` handles process signals/IPC only; core does not import the entry point. `startup-definition.ts` owns the two concrete OS file formats, while `startup.ts` uses existing managed plans/baselines/recovery. The login worker reads only an enabled saved policy bound to the same Hub directory. Installation changes the next session start; there is no generic scheduler, privileged service or automatic crash supervisor.

Policy changes use the Hub lock and first baseline. Heartbeats and stop requests are runtime control files, written with checked private replacements independently of the archive mutation lock so a busy capture can still be stopped. Stop requests carry the current generation ID; an old stop cannot disable a new selection. The exclusive lease prevents two processes from capturing the same selection, and only an explicitly restarted worker can reclaim a lease whose PID is absent. No PID is signalled from saved metadata. Reset/replacement invalidates the Hub filesystem binding. This process control does not promise a power-loss-safe transaction or unattended reboot/crash recovery.

`core/history/handoff.ts` builds bounded, version-pinned reference packets. `rawHistorySlice` shares verified block reads with existing original-byte windows, adding bounded head/tail reads without a new index, persistent export or full-transcript prompt. Handoff does not read arbitrary project files from native working-directory text, infer completed work, execute instructions, start providers or change client grants. HTTP/CLI use the same core operation; the browser copies/downloads only after a fresh access check. Browser actions live in separate startup/handoff features composed by `app.js`, preserving slice boundaries.

## Usage telemetry

`core/telemetry/settings.ts` owns the small user-level preference outside Hub recovery; `usage.ts` owns the strict event contract, detached dispatch and bounded HTTPS attempt. `workers/telemetry.ts` reads only a bounded stdin event/expected UUID and rechecks the latest preference before sending. An exclusive preference lock coordinates CLI/UI writes; Hub mutation locks would create unrelated recovery data and are not used. A busy/corrupt preference drops metrics. Telemetry never imports archived data or client settings, and there are no global Commander hooks that could count MCP/background workers as human activity. Browser features receive a named-event callback from app composition; it sends no feature state.
