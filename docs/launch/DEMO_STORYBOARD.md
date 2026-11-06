# Real demo storyboard: find a decision, continue in another client

Target length: 80 seconds. Record the working local interface, not a mockup. The recorded demo is [hub-demo.mp4](../images/hub-demo.mp4): about 70 seconds, real beta.2 interface, six fictional conversations. It ends after an actual context download; no receiving-client screen or model response was manufactured. The table below is the original shot plan, not a claim that its optional receiving-client shot was filmed.

## Prepare

- Use an isolated QA Hub and fictional conversations stored in the three supported native formats. Never film the maintainer's real archive, paths, account details, credentials, MCP environment values or private notes.
- Reuse the established fictional “Sample API” story: a Claude conversation discusses safe retries and an idempotency key; another recent message leaves timeout behavior and tests as the next step.
- Pin the source/release used for the recording. The public install route must produce that version before the video is used for launch.
- Start with a captured archive and truthful counts. Show a small caption “Fictional sample data · real interface”. Use actual observed state, with no overridden network responses or inflated counts.
- Keep the source-selection and context dialogs in English, matching the shipped interface.
- Do not imply that Hub can start the receiving client or transfer an active session.

## Shot list

| Time    | Real action                                                                                                                   | Narration / caption                                                                       |
| ------- | ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| 0–8 s   | Overview shows saved conversations from several clients.                                                                      | “I use more than one coding client. The decision I need is in an older chat.”             |
| 8–17 s  | Open All data → Chats. Briefly show Your local archive and selected source cards.                                             | “Agent Hub keeps a local copy of supported saved chats. Originals stay in their clients.” |
| 17–29 s | Search for “idempotency”. Open the matching Sample API conversation.                                                          | “Search the messages, then read the original decision.”                                   |
| 29–39 s | Point to the retry/idempotency message. Open and close Read original event if this remains readable in the recording.         | “This is the saved message, with its source record still available.”                      |
| 39–54 s | Click Continue in…, choose Codex, enter “Check timeout behavior and run the tests.”, then Prepare context.                    | “To work in another client, choose the target and describe the next step.”                |
| 54–65 s | Scroll through the two excerpt cards and source links. Click Copy context.                                                    | “Review the original excerpts before sharing them.”                                       |
| 65–74 s | Switch to a fresh Codex conversation and paste the packet without sending it. Show only the beginning and the next-step text. | “Paste into a new conversation. Hub prepares context; the client runs the task.”          |
| 74–80 s | Return to the archive with background status on; closing card links to source/quick start.                                    | “Selected sources can keep updating after you close Hub. Try it with your own workflow.”  |

If no isolated receiving-client environment is available, end on Copy context and use an accurate caption: “Paste this into a new Codex conversation.” Do not manufacture a Codex screen or claim a model response happened.

## Recording rules

- Cut pauses if needed, but disclose cuts over long operations; do not claim the edited duration is an installation or indexing benchmark.
- If preparation is cut, say the sample archive was captured before recording. Do not make the ready archive look like automatic first-run ingestion.
- No fake returned model answer. A genuine optional answer requires a separate recording, the maintainer's authorized provider use and a clearly fictional project.
- Do not demonstrate login startup by merely switching its toggle. Actual post-login behavior remains a separate manual check.
- Review every frame, the clipboard preview and audio before upload. Clear the clipboard and stop the fixture background worker when finished; leave the user's real Hub untouched.

## Final checks

Confirm the video shows the advertised version, truthful selected-source status, readable search evidence and the copy/paste boundary. Confirm captions do not say “sync every client automatically”, “complete memory”, “exact session migration” or “recovers deleted chats”. Check the destination URLs and the linked install on a fresh temporary profile.
