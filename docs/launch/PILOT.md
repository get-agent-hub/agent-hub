# Five-user pilot: does Hub replace a recurring workaround?

Draft for a manual two-week experiment. No invitations have been sent and no participants have been recruited. The operating limits below are maintainer choices, not market benchmarks.

## Recruit five eligible participants

Find five independent developers who use at least two of Claude Code, Codex CLI and DeepSeek Harness in a typical week and have a recent concrete retrieval or handoff problem. Prefer people who can show their current workaround. Do not fill the cohort entirely with friends already invested in the project.

For this first pilot, use supported macOS/Linux environments with Node.js 22.13+ and npm. Record the environment as a compatibility fact, not a reason to remove an unsuccessful participant from the funnel. A Windows volunteer can be observed separately under the experimental-support label.

Participant data stays on their computer. They choose which sources, project and messages to use, can skip any step and can stop at any time. The observer needs timings, outcomes and the participant's explanation, not transcripts, screenshots, native file paths or credentials. Ask separately before a recording; the default is no recording.

## Before the session

Verify a fresh installation of the exact release advertised. The older beta archive must not be used to test newer archive/handoff behavior. Have the quick start open, but do not preinstall or configure the participant's machine unless assistance is being measured.

Assign anonymous IDs P01–P05. Log installation failures and support time. Do not use reset, revoke existing access, enable login startup or apply shared settings merely to make the pilot easier. Existing client configuration changes require the participant's own reviewed choice.

## Opening script: 5 minutes

“I'm testing whether this tool saves work. I want to see what you do, including where it is confusing. You can use a non-sensitive example and skip anything private. I'll mostly watch; if you ask for help, I'll record that the step needed help.”

Ask before showing Hub:

1. Which two coding clients did you use this week, and for what tasks?
2. Tell me about the last time you needed an old fix or decision. What happened and what did you do?
3. When did you last continue the same task in another client? What did you carry over? What was missing?
4. How often did that happen in the last two weeks? What did it cost in time or mistakes?
5. What do you already use: native search, Markdown notes, Git, scripts or another manager? What works well enough that you would keep it?

Use one recent, non-sensitive task as the example. Do not turn “I might want that” into evidence of an actual incident.

## Task A: find the evidence

Participant prompt:

“Find the original message that explains a previous decision or fix you need for this project. Show how you know it is the right evidence.”

Observe the current workflow, then try an equivalent lookup in Hub. Start a separate timer for installation/capture and another for retrieval. If the same lookup is repeated, mark the practice effect; do not claim the second attempt proves a speed improvement. An alternate comparable lookup is useful, but this small study is qualitative.

Hub path: install → run ahub ui → All data → Chats → Sources & automatic updates → select sources → Save chats to Hub → inspect coverage → search/open evidence. The primary task is archive/search; applying ahub quick or connecting project memory is not a prerequisite for the task.

Task success: the participant finds the relevant original event/message, can identify the correct project/client, and judges it sufficient for the question. Merely seeing a plausible title or search result is not success. Record coverage failures or absent local sources separately.

## Task B: continue the real task elsewhere

Participant prompt:

“Start a new conversation in your other client with enough correct context to take the next step on this task. Use your normal workflow first, or describe the last actual handoff if repeating it would be disruptive.”

Then try Hub's Continue in… with the chosen archived chat. Let the participant pick the next-step text, inspect the excerpts and paste into the new client. The receiving client uses its normal account/model; the participant decides whether to send the prompt. Hub does not supply that model or move the original running session.

Task success: after sending, the receiving client correctly identifies the intended next action and relevant constraints, and verifies them against current project evidence. The participant can proceed without reconstructing a critical missing decision from memory. If the user elects not to send, log “packet prepared, continuation not tested”; do not count it as a completed continuation. Record incorrect assumptions, missing material, correction time and whether a short handwritten handoff was better.

Do not ask the observer to judge correctness from the packet alone. The participant owns the task's ground truth. A model repeating the packet is not by itself evidence of useful continuation.

## Optional check: archive freshness

Only after the core tasks, if the participant wants background updates:

1. Enable Update selected sources in the background for the chosen sources.
2. Close the Hub page and stop its UI server normally.
3. Add a harmless message in an existing selected native client conversation; ensure the native client actually saves it.
4. After a normal 30-second check opportunity, reopen ahub ui and find that new message in Hub.

Use a 90-second observation window, not a product SLA. Log source-save time, when Hub shows the message, background status and manual help. Machine sleep, an unsaved message and an unsupported root are different outcomes. Do not claim this tests restart/login startup; that is a separate native OS trial.

## Optional check: shared-settings preview

Offer only when shared configuration drift was their original pain. Ask them to preview one known MCP/skill change without applying it. Can they tell what is the source, destination and scope, and why a conflict needs a choice? Do not introduce a contrived conflict or widen sync to all clients. Capture whether the preview is useful, unnecessary or confusing. A successful preview is not a completed synchronization.

## Closing questions: 5 minutes

- Which task, if any, was easier? What exactly did Hub replace?
- Where did you hesitate or need help?
- What would you do next time without Hub?
- What information did you still have to reconstruct?
- Would you leave it installed for the next week? Why or why not?
- What, if anything, should be removed or simplified?

Avoid “Would you pay?” as the success metric. If pursuing a business later, test an actual paid offer separately; this pilot does not establish price or willingness to pay.

## Two-week observation and decision

Let participants use the tool normally. Fix blockers and answer requests; do not send usage reminders. Voluntary outcome notes are enough. At days 7 and 14, ask whether they used it again, when, for which actual task and what they used instead. Mark any contact as a measurement follow-up, and distinguish use before and after it. Do not count use prompted by a reminder as unprompted return.

Separate invited, installed, activated and returning participants. Activated means a useful evidence-retrieval task or a genuinely tested successful continuation, not just a launch or copied packet. Count distinct participants and distinct days, not events.

The decision gate proposed in USER_DEMAND.md is at least five activated testers, three returning on separate days without usage reminders, and a repeated task they say Hub replaces. With exactly five recruits, an activation blocker may require extending recruitment within a fixed budget; do not redefine activation to hit the gate. If recruitment fails, demand is unknown. If activated users do not return after blockers are addressed, keep Hub as a personal/open-source utility or maintenance-only project and stop feature expansion.

A passing result authorizes consideration of one demonstrated job, not the whole deferred roadmap. Document what was learned before choosing the next implementation.
