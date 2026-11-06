# Real-client trial: Codex → DeepSeek Harness

Use two real native clients to verify that useful project knowledge survives a client change. No Claude login is needed. This guide does not report a pass: record the actual results below.

The core usefulness trial takes about 10–15 minutes once both clients are installed, signed in and ready. First-time installation, client approvals and large history capture can take longer. **The conflict/recovery extension is required before calling the full real-client release gate complete.** Login startup is a separate optional OS trial.

## 1. Create one disposable project

Use the installed release under test, Node.js 22.13+ and Git. Keep the current Hub and native accounts; do not copy credentials or change authentication. Use your existing Hub/client path overrides and selected DSH profile.

From the candidate source directory, run the [supplied seed helper](../../scripts/client-trial-seed.mjs):

```sh
node scripts/client-trial-seed.mjs
```

It creates only a fresh folder under the OS temporary directory, a Git repository, unfinished dependency-free JavaScript, ten tests, two prompts and two controlled Markdown sources. It does not call Hub, start clients or modify Hub/client configuration. Copy the two printed export lines into your terminal, then check:

```sh
ahub --version
node --version
ahub status
ahub memory project ls
```

The printed `AHUB_RUN` is the trial folder; `AHUB_PROJECT` is its new `retry-demo` Git project. Keep the expected decision file outside the agent's task; it is the operator's exact-body check.

If Hub is uninitialized, complete the [quick start](../QUICKSTART.md) first. Review any shared setup with `--client codex,dsh`; do not involve Claude just to pass this trial.

## 2. Review project memory and hooks

With affected native clients idle, preview:

```sh
ahub project connect "$AHUB_PROJECT" --client codex,dsh --dry-run
```

Inspect the project, selected clients, imported notes and exact hook/profile files. Apply only the command printed by that preview, retaining its revision and timestamp. Record the workflow/run ID, project-memory ID and recovery commands. Do not force an existing conflict or apply a broader plan.

```sh
ahub memory project ls
ahub memory auto status --workspace "$AHUB_PROJECT" --json
```

Restart/reload the affected clients. Review Codex's exact hook trust prompt and DSH's selected profile permissions normally. Configuration being present is not proof the hooks ran.

Project connection installs project-gated hooks; **it does not install Memory MCP**. The main trial uses the hook's normal checkpoint command and later native-agent CLI reads. An already configured, correctly scoped Memory MCP can be used, but is not required or assumed here. Semantic checkpoints use the current agent/model and can add a continuation; normal native permissions still apply.

## 3. Let Codex implement and save one decision

Open a fresh Codex session in the printed project folder. Paste `CODEX_PROMPT.txt` from the trial folder. It asks Codex to implement the retry predicate, run only the five policy tests and leave the executor unfinished. The verified decision is: transient failures only; at most three total attempts; payment retries require one non-empty idempotency key reused for the same logical payment. The prompt also contains a unique decision reference.

Let the turn and normal Hub checkpoint finish. Then run:

```sh
ahub memory search "retry" --workspace "$AHUB_PROJECT" --json
ahub memory auto status --workspace "$AHUB_PROJECT" --json
```

Use the actual returned record ID:

```sh
ahub memory get ACTUAL_RECORD_ID --workspace "$AHUB_PROJECT" --json
```

Expected: the five policy tests pass, the executor remains unfinished, and project memory contains the **exact body** from `EXPECTED_DECISION.txt`, including its unique reference. Inspect scope, body, revision and observed checkpoint metadata. A pending checkpoint, empty acknowledgement, renamed fact or ignored save request is not an exact-body pass. Record the actual outcome; do not manually add a fact and call autosave successful.

## 4. Save the chat, then check one background append

Open `ahub ui`. In **All data → Chats → Sources & automatic updates**, select only the intended Codex and DSH stores. Choose **Save chats to Hub** or **Update archive now**. Check source coverage and find the Codex retry conversation.

Record the current background selection first. If updates already run, do not silently replace that selection; pause and review any deliberate change. Enable **Update selected sources in the background**, close the Hub page and stop only its UI server normally. In the same Codex chat, send:

> Trial archive marker: the predicate is done; the executor is still next. Do not change files. Reply briefly.

After the native client has saved the message and the normal 30-second capture opportunity has passed, reopen `ahub ui` and find the marker. Record source-save time, visibility time and coverage. Use 90 seconds as an observation window, not a promised SLA. Do not use a manual capture to conceal a failed background update; record it separately if needed to continue.

## 5. Move inspected context to DSH and verify useful continuation

In that saved Codex chat, choose **Continue in… → DeepSeek Harness**. Set the next step to completing the retry executor and verifying Hub's saved project decision. Choose **Prepare context**, inspect the excerpts and copy them. The packet is bounded reference text, not a transfer of Codex's active state.

Open a fresh DSH conversation in the same project using your normal signed-in workflow and selected profile. Paste the packet, then `DSH_PROMPT.txt` from the trial folder. No headless launch or authentication-copy command is needed.

The DSH prompt first requires actual shell-tool calls to project memory search and full record retrieval. Verify the tool result's ID, scope, revision and **full body** against `EXPECTED_DECISION.txt`; merely repeating policy from the packet or source code does not prove memory retrieval. It then asks DSH to inspect files, implement the unfinished executor and run:

```sh
npm test
```

Expected: ten tests pass. They cover successful retries, a maximum of three attempts, no payment retry without a key, the same key on every payment attempt and permanent-error preservation. Tests are dependency-free and make no network requests or real payments. Confirm the tests were not edited to pass.

A prepared packet alone is not successful continuation. Record whether DSH verified current files, retrieved the exact saved knowledge and completed the intended next step. History MCP is an optional separate scoped connection; copying this packet does not grant it.

## 6. Required extension: external Markdown conflict and recovery

This completes the remaining real-client release gate. Keep both clients idle while applying memory/configuration changes. The two `native-*` folders created by the helper are **controlled import sources**, not evidence that Codex or DSH writes native Markdown there automatically.

Attach the two identical selected notes through separate reviewed plans, applying each emitted command before continuing:

```sh
ahub memory auto enable --workspace "$AHUB_PROJECT" --client codex --native-dir "$AHUB_RUN/native-codex" --dry-run
ahub memory auto enable --workspace "$AHUB_PROJECT" --client dsh --native-dir "$AHUB_RUN/native-dsh" --dry-run
ahub memory search "disposable demo region" --workspace "$AHUB_PROJECT" --json
```

Expected: one canonical sample-region fact with both source identities, and both original notes unchanged. Record its actual ID/body/revision. Edit only the controlled Codex note's body from “west” to “east”, then preview and apply:

```sh
ahub memory auto sync --workspace "$AHUB_PROJECT" --dry-run
ahub memory auto status --workspace "$AHUB_PROJECT" --json
```

The divergent source values must be retained for review, not silently flattened. Use the actual conflict ID from status:

```sh
ahub memory auto conflict get ACTUAL_CONFLICT_ID --workspace "$AHUB_PROJECT"
ahub memory auto conflict resolve ACTUAL_CONFLICT_ID --workspace "$AHUB_PROJECT" --take hub --dry-run
```

Read both bodies. Apply the exact resolution command printed by preview, save its content-backup ID, then read the canonical sample-region fact again. Check the originals on disk and repeat sync preview: an unchanged acknowledged source should not create another equivalent conflict.

Verify a valid managed restore while no later writes have occurred:

```sh
ahub restore ACTUAL_CONTENT_BACKUP_ID --dry-run
```

Review the exact artifacts and apply only its emitted command. Read back the canonical value and queue/index state; they must match the recorded pre-resolution state. A stale restore that correctly refuses later changes is a guarded rejection, not a successful restore. Record it and repeat only a fresh isolated operation if necessary; never force rollback over newer work.

For further stale-plan, deletion, scope, native-writer and destructive cases, use the [working guide](../WORKING_GUIDE.md#10-native-source-deduplication-and-conflicts) and its isolated laboratory. Do not run the real Hub reset laboratory as routine cleanup. An actual client-native Markdown writer trial remains distinct from these controlled-source edits.

## 7. Finish without resetting the real Hub

Use the actual project-memory ID from `memory project ls`:

```sh
ahub project disconnect ACTUAL_PROJECT_MEMORY_ID --dry-run
```

Review and apply its emitted command. This disconnects all checkouts of that trial ID, disables its policy, removes pending tokens and revokes associated history access. Knowledge and project notes remain. Global handlers used by other projects remain installed and become no-ops for the disconnected trial; disconnect does not restore every client file to its earlier bytes. Use the recorded workflow recovery commands only after checking later edits and scope. See [recovery](../RECOVERY.md).

Restore the background selection/state you deliberately changed, preserving any updates that were already enabled before the trial. Keep trial evidence private. Delete the temporary project only when both clients have closed it and you no longer need the evidence; never delete a path inferred from a project label. No real Hub reset or CLI uninstall is required.

Optional login startup needs its own reviewed install and actual sign-out/sign-in check. Leave that feature marked **not tested** unless this OS trial was performed; it is not necessary to validate the context packet.

## Evidence to report

| Check                                                         | Actual result and evidence                 |
| ------------------------------------------------------------- | ------------------------------------------ |
| CLI/client versions, DSH profile and affected reviewed files  |                                            |
| Codex five policy tests; tests unchanged                      |                                            |
| Observed checkpoint and exact saved decision body/reference   |                                            |
| Initial Codex/DSH source coverage                             |                                            |
| Background append visible after page and UI server closed     |                                            |
| DSH actual memory search/get, matching body/scope/revision    |                                            |
| DSH completed the executor; ten tests; current files verified |                                            |
| Controlled-source deduplication, differing bodies retained    |                                            |
| Reviewed resolution and valid managed restore                 |                                            |
| Project disconnect and background state restored as intended  |                                            |
| Actual native Markdown writer trial                           | Not established by controlled-source edits |
| Actual OS login-start trial                                   | Not tested unless performed separately     |

Keep retrieval, checkpoint, background capture, continuation and conflict/recovery results separate. Report failures and untested items plainly. Automated fixtures, installed hooks and a copied packet cannot replace the real observations above.
