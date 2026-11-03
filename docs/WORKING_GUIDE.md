# Manual end-to-end working trial

This guide exercises all implemented flows and the important user-visible failure cases. Use macOS with zsh/bash. Run the working route through real clients first. Use a separate laboratory terminal for intentional corruption, changed bindings and full reset.

Mark each case PASS, FAIL or SKIPPED and record its evidence. A skipped case is not a pass. Timing-sensitive crash, contention, disk-failure and expiry tests remain in the automated suite.

## 0. Set up the working terminal

Replace the source path once. Keep the checkout at that path during the trial: launchers and the DSH adapter refer to its built files.

    export AHUB_SOURCE="/absolute/path/to/agent-hub"
    export AHUB_NODE="$(command -v node)"
    export AHUB_RUN="$(mktemp -d /tmp/agent-hub-manual.XXXXXX)"
    chmod 700 "$AHUB_RUN"
    ahub() { "$AHUB_NODE" "$AHUB_SOURCE/dist/cli.js" "$@"; }
    cd "$AHUB_SOURCE"
    npm run build
    git rev-parse --short HEAD
    node --version
    ahub status
    ahub memory project ls

Record the commit, client versions, actual Hub directory, selected DSH profile, affected paths, backup IDs and observations in a local result sheet. Keep originals and recovery archives private.

Use your existing AGENT_HUB_HOME and client-directory overrides; the default Hub is ~/.agent-hub. Run **ahub init --yes** only if intentionally creating a new Hub. Initialization writes files and is not a preview.

Create two disposable repositories:

    export AHUB_PROJECT="$AHUB_RUN/project-a"
    export AHUB_OTHER="$AHUB_RUN/project-b"
    mkdir -p "$AHUB_PROJECT" "$AHUB_OTHER"
    git -C "$AHUB_PROJECT" init -q
    git -C "$AHUB_OTHER" init -q

The projects are disposable; the working route still modifies your real client configs after you approve a plan. Keep affected clients idle during config writes. Before the first apply, copy each affected existing config/instruction file to a private location and record absent files/symlink targets. Preserve the existing Hub recovery directory. Its first baseline can predate this trial.

### Preview/apply convention

For each dry run:

1. Review every path, action and conflict.
2. Execute the exact printed apply command in the same configured terminal. Preserve --expect and any --at timestamp.
3. Save its backup ID and rollback command.
4. Repeat the original dry run: unchanged inputs should need no more managed changes.

CLI MCP import is different: removing --dry-run applies it, without --apply/--expect. Automatic checkpoints/watchers write under the enabled project policy. Doctor starts MCP processes and can save diagnostic state.

## 1. Existing MCP import and source selection

    ahub mcp ls
    ahub import mcp --dry-run
    ahub import mcp:SERVER_NAME --prefer claude-code --dry-run

Substitute a real server name. Expected: actions, source clients and secret variable names are visible, raw secret values are absent, and client configs stay unchanged.

If the selected import is correct, run the same command without --dry-run. It writes Hub definitions/credentials, not clients. Repeat preview: an existing Hub definition is skipped. Use --overwrite only for an intentional reviewed replacement. If no suitable definition exists, mark this import case SKIPPED and use the trial server in section 4.

## 2. Register projects and check scope

    ahub memory project register ahub-trial-a "$AHUB_PROJECT" --dry-run

Apply, then repeat: no changes expected.

    ahub memory project register ahub-trial-b "$AHUB_OTHER" --dry-run

Apply, then:

    ahub memory project ls --json
    ahub memory ls --workspace "$AHUB_PROJECT"
    ahub memory ls --workspace "$AHUB_OTHER"

Expected: distinct projects and initially empty trial collections. Registration does not create repository instructions. Another folder with the same basename must not become registered automatically.

### Import existing memory before creating new facts

Run discovery for the registered project:

    ahub memory discover --workspace "$AHUB_PROJECT"
    ahub memory onboard --workspace "$AHUB_PROJECT" --follow --dry-run

A new disposable checkout can have no matched sources; that is expected. For an existing project, inspect source IDs, checkout evidence, formats and notices, then apply the emitted plan. Unresolved sources need an explicit --source ID; known foreign-project sources are rejected. SQLite/graph stores are not flattened into notes. Without --follow this is a one-time import; with it, native sources join the project policy. Hook installation is separate, and existing installed handlers can activate for that policy.

Verify inline MEMORY.md facts, pure navigation omission, unchanged originals, repeat-import idempotence and a guarded restore. The UI offers Find existing client memory with the same source selection and preview. Use the controlled sources in section 10 when the trial checkout has no existing native notes.

## 3. Project memory CRUD and selected-text import

    cat > "$AHUB_RUN/fact.md" <<'NOTE'
    For this trial project, reuse one idempotency key when retrying the same logical operation.
    NOTE
    ahub memory add trial-retry-rule --workspace "$AHUB_PROJECT" --title "Trial retry policy" --kind decision --file "$AHUB_RUN/fact.md" --source "Manual trial" --dry-run

Before apply, get must report no such record. Apply the printed plan, then:

    ahub memory get trial-retry-rule --workspace "$AHUB_PROJECT" --json
    ahub memory search "idempotency" --workspace "$AHUB_PROJECT"
    ahub memory search "idempotency" --workspace "$AHUB_OTHER"

Expected: the exact body/revision in project-a, no matching fact in project-b, and a matching entry in project-a's managed MEMORY.md index.

Edit fact.md, copy the current revision from get and substitute it below:

    ahub memory update trial-retry-rule --workspace "$AHUB_PROJECT" --file "$AHUB_RUN/fact.md" --record-revision RECORD_REVISION --dry-run

Apply and read back. Reusing the old record revision must fail. Adding the same ID again must fail without a duplicate.

    ahub memory import trial-selected-copy --workspace "$AHUB_PROJECT" --title "Selected local note" --file "$AHUB_RUN/fact.md" --dry-run

Apply and check that the source file is unchanged. This copies selected text, not an external graph database or archived session.

## 4. Deliver the same Memory MCP server to DSH and Claude

Open the existing Hub **mcp/servers.yaml**. Add this entry under its existing servers mapping, substituting absolute paths from AHUB_NODE, AHUB_SOURCE, AHUB_PROJECT and your actual Hub directory:

    ahub-trial-memory:
      command: "/absolute/path/to/node"
      args:
        - "/absolute/path/to/agent-hub/dist/cli.js"
        - memory
        - serve
        - --workspace
        - "/absolute/path/to/project-a"
      env:
        AGENT_HUB_HOME: "/absolute/path/to/your/hub"

Retain the top-level version and other definitions. Do not create a second servers mapping. YAML does not expand shell variables. MCP add/rm CLI commands are not implemented.

    ahub mcp ls
    ahub doctor ahub-trial-memory --timeout 20
    ahub sync --area mcp --client dsh --dry-run

Expected: doctor discovers three read-only tools. Apply DSH delivery and repeat: no changes. Check preservation of unrelated profile plugins/settings.

    ahub sync --area mcp --client claude-code --dry-run

Apply separately. Reload both clients, use the reviewed DSH profile and open project-a. Ask each:

> Use the ahub-trial-memory MCP server to search for idempotency, read the full matching record and report its ID and source.

Expected: both read the exact current project-a value through actual tool calls. Other project scope strings are rejected. This scopes the server, not an agent's independent filesystem access.

To test reviewed MCP writes, append **--allow-write** to this Hub server's args and reconnect both servers. Sync can be a no-op because the launcher already reads the registry entry. Ask A to get the current record and preview an update. Inspect the proposed body/scope, then instruct A to apply that exact preview ID/revision. B must read the new value without restarting. Do not use an unrelated graph server's similarly named tools.

## 5. Skills: bundle, delivery, discovery and import

    mkdir -p "$AHUB_RUN/skills/ahub-manual-check/references"
    cat > "$AHUB_RUN/skills/ahub-manual-check/SKILL.md" <<'SKILL'
    ---
    name: ahub-manual-check
    description: Report the harmless Agent Hub manual-trial marker without external actions.
    ---
    # Manual check
    When explicitly invoked, read references/marker.txt and report its exact text.
    Do not make network requests or modify files.
    SKILL
    echo "AHUB_MANUAL_MARKER_A" > "$AHUB_RUN/skills/ahub-manual-check/references/marker.txt"
    ahub skill add "$AHUB_RUN/skills/ahub-manual-check" --dry-run

Apply, then:

    ahub skill ls
    ahub sync --area skills --client dsh --dry-run
    ahub sync --area skills --client claude-code --dry-run

Apply each plan separately. Review every affected client: Codex/DSH can share one physical root. After reloading, explicitly invoke ahub-manual-check in both clients. Both should discover the skill and read AHUB_MANUAL_MARKER_A from its reference asset.

    ahub import skills --dry-run

An equivalent linked skill must not become a conflicting copy. For actual import, select one harmless client-only skill and preview **ahub import skills:ACTUAL_NAME --prefer CLIENT_ID --dry-run**. Apply and verify the original client directory remains unchanged. Differing copies require an explicit preference.

Test replacement/removal in the laboratory rather than altering unrelated working skills.

## 6. Shared instructions and shared memory

Review Hub **instructions/AGENTS.md**. Using an editor, preserve its text and add a clearly marked trial rule:

> During the Agent Hub manual trial, label temporary example files AHUB_TRIAL.

Create a separate selected note containing a harmless shared trial preference, then:

    ahub memory add trial-shared-label --shared --title "Manual trial label" --kind preference --file "/absolute/path/to/shared-trial-note.md" --dry-run
    ahub sync --area context --client dsh --dry-run
    ahub sync --area context --client claude-code --dry-run

Apply the memory creation first; generate fresh context previews and apply them separately. Expected: personal client text survives, Claude receives imports, and DSH receives embedded rules/index. Fresh sessions can identify the rule and retrieve the shared fact.

Project-a's index must not appear in global instructions. Shared MCP reads require **--include-shared**; shared writes additionally require **--allow-write --allow-shared-write**. Without those options, requests must fail.

Changing shared text/index needs another context sync for embedded Codex/DSH content. It is not a live link to their instruction text.

## 7. Repository preparation and agent handoff

    ahub init-repo "$AHUB_PROJECT" --dry-run

Apply and inspect AGENTS.md, CLAUDE.md, .agents/state/PROJECT.md and .agents/state/NOW.md. Existing notes survive; initialization does not invent progress or commit Git changes.

Fill PROJECT.md with verified trial context. Put a small task in NOW.md, such as explaining the retry rule in a README. Ask A to make partial progress and update NOW.md with changed files, actual checks and the next action. Start a fresh B session and ask it to continue from those files and Git status.

Expected: B resumes correctly and verifies notes against the code. Repeat init-repo preview: notes survive. Task notes remain ordinary files, not an automatically extracted task database.

## 8. Real semantic autosave

    ahub memory auto enable --workspace "$AHUB_PROJECT" --client dsh --dry-run

Apply, inspect status and reload DSH:

    ahub memory auto status --workspace "$AHUB_PROJECT" --json

The policy should include dsh and the profile should load the bundled dsh-memory.js adapter. Existing plugins remain. No provider installation or permission bypass occurs.

Optionally append **--allow-auto** to the trial Memory server args and reconnect. It exposes memory_checkpoint separately from --allow-write. Without it, the hook supplies a CLI command and normal shell permissions apply.

In a fresh DSH session in project-a:

> This is a verified project decision: trial API retries must stop after three attempts. Keep it as durable knowledge when the normal automatic checkpoint runs; use a stable key such as trial-retry-limit. Complete this small task normally.

After completion, inspect memory search and auto status. Expected: one bounded checkpoint continuation, an evidenced project fact, no unexplained pending checkpoint and no repeating extraction loop. Inspect the actual stored body/scope rather than assuming the model used a particular ID.

A greeting-only turn can submit an empty facts array; it must not invent knowledge. Repeating the same decision should not create repeated equivalent records. If a checkpoint stays pending, record the actual hook/tool/permission issue instead of treating config presence as a pass.

Enable Claude for the same project through another reviewed **memory auto enable --client claude-code** plan and repeat. Codex is an optional third client: select --client codex, review/trust the exact hooks in its native UI and start a fresh session.

## 9. Cross-client freshness and project switching

Ask B to read the retry-limit decision using the trial MCP server or CLI. Give an explicit user correction, let it save, then ask A to read the new value. Neither client should require a second canonical store.

A fresh session in project-b must not automatically inherit project-a's enabled policy. The trial MCP server is explicitly fixed to project-a; do not use it as evidence of project-b isolation. A separate server bound to project-b must see only its collection.

An already bound session must not save into another enabled project after a cwd change. Start a fresh session when changing projects. DSH user forks may use memory; delegated subagents must not independently request checkpoints.

## 10. Native source deduplication and conflicts

Use controlled source folders first. These are test inputs, not proof that the client's native writer already uses them.

    mkdir -p "$AHUB_RUN/native-claude" "$AHUB_RUN/native-dsh"
    cat > "$AHUB_RUN/native-claude/trial.md" <<'NOTE'
    # Trial native rule
    Native trial imports preserve both source identities.
    NOTE
    cp "$AHUB_RUN/native-claude/trial.md" "$AHUB_RUN/native-dsh/trial.md"
    ahub memory auto enable --workspace "$AHUB_PROJECT" --client claude-code --native-dir "$AHUB_RUN/native-claude" --dry-run

Apply Claude's source setup first, then:

    ahub memory auto enable --workspace "$AHUB_PROJECT" --client dsh --native-dir "$AHUB_RUN/native-dsh" --dry-run

Apply. Expected: one canonical fact, two retained source identities, unchanged originals.

    ahub memory search "both source identities" --workspace "$AHUB_PROJECT"
    ahub memory auto sync --workspace "$AHUB_PROJECT" --dry-run

Change Claude's trial.md body and preview/apply sync. DSH's older source must become a visible conflict rather than an obsolete duplicate. Once the conflict is recorded, another unchanged sync should propose no additional writes.

    ahub memory auto status --workspace "$AHUB_PROJECT"
    ahub memory auto conflict get CONFLICT_ID --workspace "$AHUB_PROJECT"
    ahub memory auto conflict resolve CONFLICT_ID --workspace "$AHUB_PROJECT" --take hub --dry-run

Use the ID from status. Review both bodies and apply. The current Hub value stays, and this source version is acknowledged. Unchanged sync must not requeue it.

Change the DSH note again, inspect the new conflict, then preview/apply --take incoming. Read back the exact accepted version. Independent sources can now need their own resolution: resolve each deliberately. Align controlled source bodies and acknowledge remaining conflicts until preview is stable.

Conflict get lists immutable incoming history hashes. Read an earlier version with --version HASH, including after resolution. UI Review conflict also displays both values and offers a guarded choice.

For the actual native-writer test, locate the real project-specific native directory, review adding it with --native-dir, then ask that client to save one harmless native note. Confirm its file change and later Hub import. Do not select a global multi-project collection or served graph database. Hub does not write its records back to native sources.

## 11. Manual edits, deletion, watching and disable

Using a controlled native fact:

1. Update its Hub record through CLI/UI using the current revision.
2. Change its native source and sync: expect a conflict, with the manual correction preserved.
3. Delete that Hub record through a reviewed memory rm plan.
4. Sync unchanged source: deletion survives and a conflict is visible.
5. Resolve with --take hub: unchanged sync must not resurrect it.
6. Delete a source note: existing Hub knowledge must remain.

In another terminal with the same Hub and workspace:

    ahub memory auto watch --workspace "$AHUB_PROJECT" --interval 5

Change a controlled note while clients are idle. Its addition/update/conflict should appear on the next successful scan. Stop with Ctrl+C and verify the watcher exits. It is a foreground process, not an OS service.

    ahub memory auto disable --workspace "$AHUB_PROJECT" --dry-run

Apply. New captures must fail; hooks become no-ops for this project and facts/native notes remain. A watcher stops after observing the disabled policy. Re-enable only through reviewed setup if continuing.

## 12. Local UI

    cd "$AHUB_PROJECT"
    ahub ui --port 0 --no-open

Open the printed local URL. Verify:

- Overview/MCP source matrix reflects files; import/sync preview matches CLI intent.
- Skills search/full SKILL.md and delivered reference asset are correct.
- Instructions/Memory sources and project/shared scopes are distinct.
- Memory create/read/update/delete uses preview then apply with backup.
- Changing a form field invalidates the old preview.
- A title containing `<script>alert(1)</script>` is literal text and executes nothing.
- Review conflict shows both exact values; a changed queue/record rejects old apply.
- Repository actions bind to project-a and preserve existing notes.
- Doctor completes/cancels; cancelled is not displayed as success.
- Narrow windows and long paths remain usable.

A used preview cannot be applied twice. Restarting the UI discards server-local previews. Sessions and MCP add/rm remain unimplemented. Stop UI before recovery.

## 13. Roll back a disposable operation

Create a uniquely named trial memory record and immediately save its content-backup ID. Before later mutations:

    ahub restore CONTENT_BACKUP_ID --dry-run

Apply its printed command. The record should disappear together with its matching index/ownership changes, while earlier facts remain.

For stale restore rejection, create a second disposable fact, retain its backup, update the fact and preview the older restore. Expected: conflict rather than loss of the newer value. Use a current valid operation instead of forcing the old one.

Restore/reset revoke outstanding checkpoint tokens. An old token must fail even if its prior state was restored; a new real prompt obtains a fresh opportunity. The laboratory can reproduce this without waiting for a model.

## 14. Working-route cleanup

Decide whether to keep this setup. Remove only trial records, the trial skill, trial rule and trial MCP entry that you created; inspect resulting delivery plans. Do not remove similarly named pre-existing content.

To consider undoing the whole setup, stop UI/watchers/affected clients and inspect:

    ahub reset --dry-run

Reset targets the **first recorded baseline**, not the start of this guide. It can restore the entire Hub and recorded repository/client files. Keep an independent backup and review every path before a production reset. Otherwise use valid individual restores and leave full reset for the laboratory.

External edits block ordinary reset. --archive-changes explicitly archives current edited regular files/directories before whole-file restoration; it is not a merge. Repointed symlinks stay blocked. Keep originals, run data and recovery archives until verified.

## 15. Intentional-failure laboratory

Open a **new terminal**. These overrides isolate all Hub/client writes. Do not launch an actual client with the synthetic DSH profile.

    export AHUB_SOURCE="/absolute/path/to/agent-hub"
    export AHUB_NODE="$(command -v node)"
    export AHUB_LAB="$(mktemp -d /tmp/agent-hub-failures.XXXXXX)"
    export AGENT_HUB_HOME="$AHUB_LAB/hub"
    export CLAUDE_CONFIG_DIR="$AHUB_LAB/claude"
    export AGENT_HUB_CLAUDE_CONFIG="$AHUB_LAB/claude.json"
    export CODEX_HOME="$AHUB_LAB/codex"
    export DSH_HOME="$AHUB_LAB/dsh"
    export DSH_AGENTS_HOME="$AHUB_LAB/agents"
    export AGENT_HUB_SHARED_SKILLS="$AHUB_LAB/shared/skills"
    export AGENT_HUB_DSH_PROFILE="trial"
    ahub() { "$AHUB_NODE" "$AHUB_SOURCE/dist/cli.js" "$@"; }
    mkdir -p "$CLAUDE_CONFIG_DIR" "$CODEX_HOME" "$DSH_HOME/profiles/trial" "$AHUB_LAB/project" "$AHUB_LAB/native"
    git -C "$AHUB_LAB/project" init -q
    echo '{"mcpServers":{}}' > "$AGENT_HUB_CLAUDE_CONFIG"
    echo '# Manual laboratory configuration' > "$CODEX_HOME/config.toml"
    echo '[]' > "$DSH_HOME/profiles/trial/cordis.patch.yml"
    ahub init --yes --no-git

Seed a local fixture MCP server; it makes no provider requests:

    "$AHUB_NODE" --input-type=module <<'JS'
    import fs from 'node:fs';
    import path from 'node:path';
    const server = {
      command: process.env.AHUB_NODE,
      args: [path.join(process.env.AHUB_SOURCE, 'tests/fixtures/doctor-server.mjs')],
      env: { FIXTURE_MODE: 'healthy' }
    };
    fs.writeFileSync(path.join(process.env.AGENT_HUB_HOME, 'mcp/servers.yaml'), JSON.stringify({ version: 1, servers: { 'trial-demo': server } }, null, 2));
    JS
    ahub sync --area mcp --dry-run

All target paths must stay under AHUB_LAB. Apply and repeat: no changes.

### L1. Stale previews and client definition conflicts

Preview sync and save its apply command. Append a comment to the lab Codex config, then run the old command: changed inputs must be rejected. A fresh plan preserves the comment.

Change trial-demo's command/args in the lab Codex config. Plain sync must conflict. Review **ahub sync --client codex --replace=trial-demo --dry-run**; applying its revision may replace that exact variant, preserving unrelated settings.

### L2. Skills, instruction blocks and bindings

Create/deliver a harmless lab skill as in section 5. Replace its delivered link with a differing local directory: plain sync must conflict; migration needs an exact --client/--replace choice. Remove the lab skill through skill rm, then sync: only unchanged owned delivered links should be removed.

Add harmless Hub rules and deliver context. Edit inside a managed client block: delivery must block. A personal line outside an intact block survives. Also test duplicate/missing markers and a non-empty Codex AGENTS.override.md. Save and restore exact fixture bytes between subcases.

Repoint a delivered skill link: sync/reset must preserve or report the changed binding. --archive-changes must not silently authorize a repointed link.

### L3. Native import validation

    ahub memory project register lab-project "$AHUB_LAB/project" --dry-run

Apply, then:

    ahub memory auto enable --workspace "$AHUB_LAB/project" --client dsh --native-dir "$AHUB_LAB/native" --dry-run

Apply and add source files under that lab native directory. Preview/apply sync and inspect status for each case:

| Source/input                                        | Expected result                                 |
| --------------------------------------------------- | ----------------------------------------------- |
| MEMORY.md or hidden file                            | Not imported as a fact                          |
| Two equal topic notes                               | One canonical fact; both identities retained    |
| Fenced Markdown with a second-level heading         | One intact code example                         |
| Different Python indentation                        | Distinct knowledge; spaces preserved            |
| Invalid YAML or UTF-8                               | Skipped source; private body absent from status |
| Symlink to an outside note                          | Not followed; original retained                 |
| Missing source directory                            | Visible source issue                            |
| Duplicate headings or file/byte/depth limit         | Explicit scan failure; no partial source batch  |
| Fake sk-fixtureCredentialValueNeverPersist123456789 | Possible credential skipped, body not retained  |
| Source directory overlapping Hub                    | Rejected                                        |
| Source edit after sync preview                      | Stale apply rejected                            |

Use only fake credentials. Corrupt canonical Hub record YAML here only: reads/writes should fail closed. Restore its exact saved bytes before continuing.

### L4. Session capability, one-use token and restore replay

Create a Stop payload after enabling DSH for the lab project:

    "$AHUB_NODE" --input-type=module <<'JS'
    import fs from 'node:fs';
    import path from 'node:path';
    fs.writeFileSync(path.join(process.env.AHUB_LAB, 'stop.json'), JSON.stringify({
      cwd: path.join(process.env.AHUB_LAB, 'project'),
      session_id: 'manual-capability-session',
      hook_event_name: 'Stop'
    }));
    JS
    ahub memory auto hook --client dsh < "$AHUB_LAB/stop.json"

Copy the issued token/exact checkpoint command. A second identical Stop must not issue another continuation. Feed the supplied checkpoint command this JSON on stdin:

    {"session":"manual-capability-session","facts":[]}

Expected: one empty acknowledgement; reuse, wrong token/session, wrong project and disabled policy are rejected.

For replay after restore, start a new UserPromptSubmit opportunity, then Stop. Save one harmless evidenced fact instead of an empty array, retain the capture backup, restore it and retry its old token: it must fail. Change the hook_event_name in a copied payload to UserPromptSubmit and add a real prompt string for a new opportunity. Expiry is tested automatically; no need to wait 24 hours manually.

### L5. Doctor health and cancellation

Change FIXTURE_MODE in the lab registry between runs:

| Mode          | Expected doctor result                      |
| ------------- | ------------------------------------------- |
| healthy       | Three tools across two pages                |
| empty         | Healthy, zero tools                         |
| resources     | Healthy resource-only server                |
| tools-hang    | tools/list timeout                          |
| unavailable   | Service-style failure, no raw secret output |
| package-cache | Package-cache diagnostic                    |
| malformed     | Protocol failure                            |
| hang          | Timeout/cancellation and descendant cleanup |

Run **ahub doctor trial-demo --timeout 2** or cancel through UI. Restore healthy mode afterward. Doctor never invokes discovered tools. For n8n, backend availability is separate from MCP discovery; an intentionally stopped backend can warn without requiring a cluster restart.

### L6. Whole-baseline reset and archives

First restore any intentionally changed symlink bindings or corrupt storage from earlier lab cases. Add/edit lab facts and client settings. Ordinary reset should block external client edits.

    ahub reset --dry-run
    ahub reset --archive-changes --dry-run

Review the second plan and apply its exact command. Because this lab used a fresh init, the generated Hub should return to absence, original empty client configs should return, and later data should remain in the printed archive. Native files outside Hub remain intact.

A live/ambiguous lock owner must not be removed. Use --recover-lock only to inspect a stopped owner's recovery. Do not kill real clients or simulate disk exhaustion; automated fault-injection tests cover interrupted writes.

Close the lab terminal so its overrides do not leak into daily use. Keep the recovery directory; this guide provides no recursive cleanup command against a working Hub.

## 16. Completion and limits

The real working trial passes when selected clients discover the intended skill/instructions/MCP, exchange the same scoped facts, save useful evidenced knowledge or acknowledge no learning, preserve external edits, expose resolvable conflicts, stabilize repeated sync and support reviewed rollback. Record which clients/native writers were actually exercised.

The lab must demonstrate stale-plan rejection, malformed-source diagnostics, ownership/binding protection, deletion retention, token one-use/recovery invalidation and reset with archives. Run automated tests for concurrency, clock expiry, crash recovery and injected write failures.

Not implemented: graph-memory interchange, archived-session indexing, MCP add/rm, automatic task-state extraction or an installed background service. Remote CI, npm release identity/version and website deployment are later work.

References: [MEMORY.md](MEMORY.md), [AUTOMATION.md](AUTOMATION.md), [CONTENT.md](CONTENT.md), [RECOVERY.md](RECOVERY.md), [QA.md](QA.md).
