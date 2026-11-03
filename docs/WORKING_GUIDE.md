# First personal working run

The automated suite uses isolated client homes. This guide is for a deliberate first run with your actual clients after reviewing those checks. Use one client first, then add the others. Nothing here publishes a package or deploys the landing page.

## 1. Inspect the current setup

```sh
npm run build
node dist/cli.js status
node dist/cli.js skill ls
```

Keep affected clients idle while applying their settings. Use your existing `AGENT_HUB_HOME` and client-directory overrides. For a fresh installation, run `init` first; that writes the Hub and records a pre-creation baseline. Existing installations capture their first available checkpoint, not unknown earlier history.

## 2. Collect and deliver skills

```sh
node dist/cli.js import skills --dry-run
```

If copies differ, review them and repeat with the desired source, for example `--prefer codex`. Apply only the exact command printed by that preview. This copies skills into Hub and leaves client sources unchanged.

```sh
node dist/cli.js sync --area skills --client codex --dry-run
```

Review the entire plan, including additional client roots and shared Codex/DSH paths. If an existing differing copy should be replaced, repeat with `--replace=the-exact-skill-name` and review again. Apply the printed revision-guarded command. Repeat the plain dry run: it should have no further managed changes. Verify the skill is discoverable in the actual client. Do not invoke a skill with external side effects just to test discovery.

## 3. Deliver common rules and memory

Create or review `instructions/AGENTS.md` and `memory/MEMORY.md` in Hub. Keep a short index and separate fact files. Start with a harmless preference you can recognize.

```sh
node dist/cli.js sync --area context --client codex --dry-run
```

Review and apply the printed command. Open a fresh client session and ask it to identify its shared instruction sources and read a fact from the Hub index. Check the real answer against the file. This confirms actual model/context use; doctor only checks MCP protocol discovery. Native automatic memory is not migrated by this command.

## 4. Try a repository handoff

From a small repository you control:

```sh
node /absolute/path/to/agent-hub/dist/cli.js init-repo --dry-run
```

Use your actual CLI path; the path above is a template. Review and apply the exact printed command. Fill in PROJECT.md with verified facts and NOW.md with a small real task, completed work, checks and next action. Switch agents in that repository and ask the second agent to continue from those files. Inspect whether it resumes the right work. Repeat init-repo preview to verify that your notes are preserved.

## 5. Check the way back

Save the backup IDs printed by apply operations. Preview `restore <backup-id> --dry-run` before deciding to undo a particular operation. Preview `reset --dry-run` to inspect full recorded recovery. Do not apply reset merely to confirm that preview works: it restores whole recorded files and archives the current Hub.

Once this run is comfortable, expand to the other clients. The release stage follows this personal working run: remote macOS/Linux CI, package install smoke test, npm identity/version and a separately chosen website host.
