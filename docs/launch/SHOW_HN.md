# Show HN draft

Status: ready for maintainer review; do not submit until the linked install route matches the demo. No submission has been made.

## Submission

Title:

> Show HN: Agent Hub – Find old coding chats and carry context between clients

URL:

https://github.com/get-agent-hub/agent-hub

Use the runnable source repository as the submission destination. The repository links to installation, the local interface, limitations and the demo. Link a verified current release from there before posting. Do not use an older beta as the download for newer demonstrated features.

## Short body, if a text submission is preferred

Agent Hub saves supported local chats from Claude Code, Codex CLI and DeepSeek Harness in one searchable archive. Open an old conversation, inspect the original messages and prepare excerpts to paste into a new chat in another client.

It runs locally and leaves native conversations in place. Background updates use the sources you select. The context packet is original text with source references, not a transfer of the client's running state.

Source and setup: https://github.com/get-agent-hub/agent-hub

## First maker comment

I built Agent Hub to find work spread across coding clients and take useful context into the next conversation.

The flow I'm testing is small:

1. Choose local history sources and save them to Hub.
2. Search for a previous fix or decision and read its original messages.
3. Choose “Continue in…”, review the excerpts and paste them into a new Claude Code, Codex or DeepSeek Harness conversation.

Hub can keep the selected sources updated after its interface closes. It also manages shared MCP settings, skills and instructions, with previews before configuration changes. Those are separate from chat capture.

This is an open-source local tool. Setup currently needs Node.js 22.13+ and npm; macOS and Linux are supported, and Windows is experimental. There is no advertised public npm-registry install yet. The quick start explains the source installation.

It reads supported saved local files. It cannot recover unsaved, deleted or cloud-only history, and unavailable attachments are marked. Preparing context makes no extra model request; the receiving client still uses its own model and permissions. It does not move an active session between tools.

There are already good tools in this area, including Hansard, CC Switch and Rulesync. I'm not claiming a new category. I'm trying to learn whether this particular retrieval-to-continuation flow saves enough effort to keep using.

If you already alternate between these clients: what was the last task where finding an old decision or explaining the context again cost you time? I'd like to hear how you handled it, and where this flow would still fail.

Source: https://github.com/get-agent-hub/agent-hub
Guide and screenshots: https://getahub.dev

## Posting notes

- Post only once the current installation succeeds from the advertised link.
- Be available to explain actual limitations and help with installation failures.
- Do not ask for upvotes, coordinate voting or paste the same pitch into unrelated discussions.
- Offer the pilot to people who explicitly ask to try it; do not collect their chat contents.
- Keep the post and first comment together in the launch log. Record useful questions, not just points or traffic.
