# Replacing existing client MCP launchers

A client may already contain a launcher whose behavior differs from the registry: a wrapper script, another transport or an older executable. Normal sync treats this as a conflict. No script filename, personal directory or provider name grants automatic ownership.

Before replacing it, compare the effective command, arguments, working directory, environment, authentication and proxy behavior. A wrapper can carry required behavior that is absent from its client configuration. Keep the canonical hub definition and credentials when they already express the desired launch; re-importing a wrapper would merely move the indirection into the registry.

## Review the replacement

```sh
node dist/cli.js sync --client dsh --replace first-server second-server --dry-run
```

`--replace` selects exact existing records and requires one client. Other in-scope registry servers still follow normal sync, including additions and previously owned removals, so review the complete file plan. Unselected conflicts, unsupported client fields, missing variables, client scope and application-owned records retain their normal protections. Unknown or missing replacement names are rejected.

Dry run writes nothing and prints the exact apply command with the selected names and `--expect <revision>`. Applying an explicit replacement without that revision is rejected. A changed input invalidates the reviewed plan. The hub registry and `.env` are not overwritten by this operation.

## Apply and verify

Run the exact apply command only after reviewing the whole file plan. Sync saves a private backup before writing and uses the standard guarded transaction. Restart the affected client to load the new launchers.

Run a normal dry run again, without `--replace`. Successfully migrated records now belong to the hub and should be unchanged. Doctor initialization and tools/list can check their connectivity without invoking tools; readiness and provider API permissions are separate concerns.

## Roll back

```sh
node dist/cli.js restore <backup-id> --dry-run
```

Restore prints another revision-guarded apply command. It refuses to overwrite a client file changed since the backup. Keep old scripts until migration is verified; the migration does not delete them.
