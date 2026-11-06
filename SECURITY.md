# Security policy

## Supported versions

Security fixes target the latest beta candidate on the main development branch. There is no stable release or commitment to backport fixes to earlier snapshots yet. Use the exact version and commit recorded in the release manifest when reporting an issue.

## Report a vulnerability privately

Use the repository's **Security → Report a vulnerability** entry when private vulnerability reporting is enabled. If that entry is unavailable, contact the repository owner through the contact methods on their GitHub profile to arrange a private channel. Do not put vulnerability details, credentials, Hub contents or recovery files into a public issue. Maintainers must enable private reporting before advertising the repository as ready for public reports.

Include the affected version/commit, operating system, Node version, impact and a minimal reproduction using fictional data. Redact client paths, project notes, tokens and environment values. Do not attach an entire Hub, native client configuration or raw process logs. No response-time SLA is offered during beta.

## Security boundaries

Agent Hub is a local configuration and knowledge manager, not an execution sandbox. MCP servers, skill scripts and client hooks run with the current user's permissions. Review imported commands and sources. `doctor` starts configured MCP servers to initialize and list tools; it does not establish that arbitrary tools or upstream operations are safe.

The local UI binds to loopback and requires a session token for mutations. Do not expose it through a public reverse proxy. Credentials and recovery files remain local; protect the Hub and its sibling recovery directory. Secret extraction is conservative and does not guarantee recognition of every credential format.

Reviewed revisions, ownership checks, a Hub lock and compensating rollback protect managed operations. Independent clients do not honor that lock, and multi-file operations cannot guarantee machine-crash durability. See [RECOVERY.md](docs/RECOVERY.md) for exact limits. To report an ordinary bug, use the issue tracker with a redacted fixture instead.

## Basic usage analytics

Collection is on by default, with a persistent off switch in Sources & settings and `ahub telemetry off`. `DO_NOT_TRACK=1` suppresses it before any action. Strict event allowlists exclude chat text, search phrases, paths, settings and credentials. Website and product UUIDs are separate. See [the exact fields, lifecycle and limits](docs/UI.md#usage-analytics). A public metrics endpoint cannot prove real usage and must not be used for billing or authorization.
