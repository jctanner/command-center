# Task 0013: Background-task feedback

Owner: CC dev
Claimed: 2026-11-05
State: done
Completed: 2026-11-05

## Goal

Show provider-evidenced Claude background tasks separately from foreground Ready/Working: compact card counts and phone-friendly chat summaries with descriptions, elapsed time and completion/failure/unverified states. A tool result that launched a task must not imply task completion. Consume explicitly marked native task notifications without restoring their XML as human chat. Bound scanning/results, expose incomplete evidence, and leave input/outbox/read-state semantics untouched. No task output-file polling or extra SSH connections.

## Implementation

Native Claude async tool-result IDs pair with launch descriptions, and explicitly provider-marked task notifications update those task IDs. Ordinary human XML cannot become task evidence. Native subagents yielding to child work show Waiting; stale/unknown states show unverified rather than assumed running/finished. Terminal task outcomes do not regress from duplicated launch results. Tool activity now labels successful background launches Started in background. Raw XML remains excluded from chat.

Queue/status and conversation API snapshots expose up to eight recent task rows from a bounded 512 KiB process-linked log tail, with timestamps and limited/unavailable flags. No task-output-file reads or additional SSH connections. No database/history copy or changes to foreground phase, send permissions, outbox or reply/read cursors. The visible-history cache prefix advances independently from reply cursors so existing rows refresh.

Cards show compact observed task counts/recent outcomes; the expandable chat panel shows descriptions, elapsed time, explicit outcomes and evidence limitations. Phone panel and task list scroll within bounded height. Stale/disconnected observations cannot keep showing active tasks as verified. Unsupported providers remain unchanged.

## Validation

53 agent Python tests passed, including launch/completion distinction, task-ID pairing, subagents waiting, terminal/nonterminal/stale states, hidden XML, ambiguous/foreign/future/malformed evidence, bounded output and unchanged visible replies/cursors. All 39 Rust library checks, Clippy -D warnings, formatting, frontend TypeScript/Vite and release builds passed. Two desktop/phone background UI checks passed (26.4s): count visibility, preserved Ready state/compact card height, descriptions/duration/outcome transitions through unchanged-history responses, unavailable states, safe literal rendering and zero message POSTs/phone terminal attachments. Two existing all-provider inline activity/compact-card regressions passed (5.1s). Phone screenshot inspected; no horizontal overflow.

Deployed backend/frontend and verified HTTPS index and health. A live read of the reported Corsair agent returned four process-linked task rows: one running, two completed and one failed, with history limitations disclosed. Card and conversation API summaries both verified; raw task-notification XML remained absent from human messages. No live messages, task controls or output-file reads performed.

## Handoff

Reload app. Card counts and the Background tasks section now explain observed Claude background work; expand for descriptions and timing. This is recent evidence, not a durable complete task inventory or a progress percentage. Next task 0014; next bug 0009. Task 0009's unrelated legacy receipt choice remains pending.
