# Task 0072: Agents workspace polish (CC-76–79)

Owner: CC dev
Claimed: 2026-11-15
State: done (deployed with explicit human approval)

Human explicitly requested four live CC tickets from task0071's screenshot recommendations and implementation of all four. Created CC-76 activity grouping, CC-77 readable/synchronized token summaries, CC-78 search/card scanning, CC-79 toolbar/outbox scope. Existing CC dev owns this work; no new agent launches. Preserve approval/trust separation, message/receipt targeting, drafts/read guards and compact zero-terminal traffic. UI work only; no backend restart, provider input, commit or push requested. Record actual browser/build verification and screenshot evidence. Set tickets to Review after implementation/validation, not automatically Done.

Design: group only adjacent completed tool and recorded thinking entries, never across chat messages or pending/error/background entries; stable membership preserves expansion and focus across polls. Token cards retain cumulative totals, show known usage without guessed limits and synchronize only fresh process/conversation-matching selected detail. Search is local, composes filters and does not steal composer shortcuts. Scoped outbox is exact host/session/window/pane/process; hide/guard global bulk actions there rather than mislabel them as scoped operations.


## Implemented

- CC-76: adjacent completed tools/recorded thinking entries become expandable runs without crossing messages or pending/error/background work. Preserve open membership, focused summaries, pagination and visible message anchors. Approvals/questions/trust remain independent.
- CC-77: compact reported-use/total labels with honest Usage unreported fallback; exact Token details retain unknown fields and provenance. Only matching fresh process/conversation data synchronizes selected card/header; stale/native-link/project-history/replacement guards prevent transfer. Inline collapsed Token details recovered the existing keyboard-height budget (bug0037).
- CC-78: bounded local multi-term search composes filters, / shortcut outside editors/dialogs, keyboard card navigation and Escape clear. Search does not replace the opened conversation; drafts/focus/list state retained. Slightly wider title column, compact cards with readable usage row, soft custom-color fills, and existing attention/pin/selected cues.
- CC-79: uniform toolbar sizing, All outboxes global versus Agent outbox exact process scope. Scoped views freeze their target and hide/guard global bulk operations; individual receipt guards unchanged.

## Actual validation

`npm --prefix web run build -- --outDir dist-next` and `git diff --check` pass. Frontend-only: no Rust/API handler changes and no unnecessary Rust test rerun.

Playwright passed:13 new polish cases;5 native metrics/API/UI cases;8 existing agent activity/approvals/card/preferences/attention cases;1 existing phone virtual-keyboard case;21 existing trust/questions cases (real-provider cases skipped);18 existing durable-outbox cases verified across the full run and a targeted rerun after updating the bulk test to explicitly open All outboxes. Initial failures were corrected or fixture expectations updated for intentional labels, readable usage-row height and theme-token colors. No permission/receipt guard tests weakened. Group pending-to-complete focus and message-anchor preservation have dedicated regressions. Phone portrait393px, short landscape852×393, laptop1280×768/900 and desktop1440px checked.

Read-only staged preview against live API:1440/1280/393px, zero page errors/API writes/terminal sockets/horizontal overflow. Screenshots inspected under ignored .local/reviews/agents-improvements. Conversations now show human/assistant text between compact work summaries instead of full-height event walls; selected card/header counters align. Original native-agent processes were not controlled or restarted.

## Live tickets and release handoff

Human explicitly requested live tickets: CC-76/77/78/79 created, owned by the existing CC development context, worked In progress and moved to Review with checked acceptance items and validation summaries. No automatic Done or new agent launches.

Frontend publication was attempted only after implementation/checks were concrete, but automatic approval review rejected execution: served production assets require a separate explicit human deployment request. The publish command did not execute; production index differs from staged index. Asked human via async approval; no response yet. No workaround/retry, service restart, commit or push. Prepared .local/publish-agents-polish.py retains previous web assets, atomically publishes index after hashed assets, checks all four existing access paths and confirms backend/config/pane PID preservation. Execute only after explicit approval. Existing user instructions and review rejection remain authoritative.

Final refreshed staged screenshots after the inline-disclosure fix:1440/1280/393px, zero page errors/terminal sockets/horizontal overflow. Two automatic read-ack attempts (one per desktop preview) were blocked by the read-only browser route; no API writes reached the backend. Deployment approval remains pending, and production assets remain untouched.


## Approved frontend publication

Human explicitly requested deploy, resolving the earlier approval-review block. Executed .local/publish-agents-polish.py successfully at 2026-11-16T01:41:56Z: assets backed up/published with atomic index swap; all four configured health/index paths healthy; backend process/start/executable, configuration hashes and canonical tmux pane PIDs unchanged. Live laptop1280px/mobile393px verification: grouped activity and scope controls present, zero page errors/API writes/terminal sockets/horizontal overflow. CC-76–79 deployment evidence recorded; tickets remain Review for human acceptance. No service/native-agent restart, commit or push. Reload once for the new bundle.
