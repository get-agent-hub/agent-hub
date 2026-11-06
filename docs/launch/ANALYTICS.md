# Basic analytics reports

Collection policy: on by default, with independent website and product off switches, DNT/GPC support and no session replay. This measures participating browser IDs and installations, not all visitors, unique people or proven task success. Do not join website and product identities.

## Verify the destination first

In the provider's Project settings, compare the project token and **Region** with the relay configuration. A US project needs the US ingestion endpoint; EU needs EU. A write-only API acknowledgement is not evidence that events reached the intended project. Send an explicitly marked fictional `test:true` event through the relay and find it in Activity before counting real traffic. Do not use real transcripts or machine IDs as test fixtures.

## Shared filters

Every production report must require `is_test = false`. Set `surface = website` or `surface = product` as appropriate. The relay prefixes IDs by surface; testing uses a separate `test:` prefix. Keep testing traffic out of dashboards, activation and retention.

| Report                      | Events / settings                                                                                | What it actually measures                                                                                         |
| --------------------------- | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| Website reach               | Website `$pageview`, unique IDs, daily; break down by `page`, `language` or `source`             | Participating browsers on reviewed page groups; technical docs are grouped together                               |
| Installation interest       | Website `$pageview` → `setup_guide_opened`, 1 day; `install_command_copied` as a separate action | Interest and successful clipboard copy, not completed installation                                                |
| Source and release interest | Website `source_opened` / `release_opened`, unique IDs                                           | Link clicks, not a downloaded/installed package                                                                   |
| Active installations        | Product, any of the seven allowed events, unique IDs, daily/weekly                               | Installations performing an instrumented action; background polling/capture is excluded                           |
| Guided setup                | Product `setup_completed`                                                                        | A completed shared setup workflow; it does not prove a live MCP backend or cover every manual setup route         |
| Archive usefulness          | Product `search_performed` and `context_exported`, unique IDs                                    | Successful searches and packets output/copied/downloaded; an export does not prove the destination client used it |
| Return use                  | Product first meaningful action → meaningful action on a later day, retention over 7/14 days     | Repeated instrumented use among participating installations                                                       |

A meaningful action for the return-use report is `search_performed`, `chat_opened` or `context_exported`. Start with the retention chart's “performed any” group for those events at both ends. Do not count automatic history scans as return visits. `app_opened` describes the local browser UI; successful CLI search/read/export has its own event without a global CLI startup hook.

Product fields: event name, installation UUID, language and version. Website fields: event name, browser UUID, language, reviewed page group and coarse referrer category. No user/project/chat IDs, paths, free-form properties, search text, raw referrer or query string is sent. The provider receives the relay's network connection, not forwarded client IP/cookies/user-agent. Review provider-side retention and IP-discard settings in its own project.

## Interpretation limits

- DNT/GPC, opt-out, CI/test suppression, blocked storage, unavailable endpoints and timeouts reduce observed traffic.
- Two-second product event bursts may be coalesced; refresh/pagination does not generate extra chat-open/search events. Website same-name bursts within one second are coalesced.
- Turning off drops unsent work and removes the saved ID. Re-enabling creates a new ID, so one person can appear as more than one installation/browser.
- There is no queue, retry/backfill or exactly-once guarantee. Page navigation can interrupt website delivery. Do not calculate billing or security decisions from these counts.
- A website-to-product funnel is unavailable because identities are deliberately separate. A copied install command is not an installation conversion.
- These reports have no demonstrated retention/adoption numbers until real users perform the flow. Synthetic events establish transport behavior only.
