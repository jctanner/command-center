# Task0098: Upgrade coordinator broker by exact-conversation handoff

Owner: CC dev; claimed2026-11-17; State: done.

Human explicitly approved cc-coordinator ACP→native→ACP round trip to load deployed busy-time queue capability. Use existing guarded preparation/one-use action/status APIs, same host/session/window/pane and independently verified conversation. Verify each leg before next, preserve card metadata and other pane PIDs, no chat/input/approval or new conversation. Record exact opaque receipts privately; never replay an uncertain action. No CC backend restart, install, commit or push authorized by this operational task.

## Result and evidence

Human-approved operational round trip completed using existing prepare/one-use POST/status APIs only. First ACP→native receipt completed with exact persisted conversation and original target verified. Initial native→ACP grant was rejected before mutation (not_sent) because startup evidence changed; the native coordinator remained Ready. After a settled screen, a fresh grant completed. The rejected receipt was never replayed. A private continuation script indentation error occurred before consuming the fresh grant; its still-prepared state was checked before one submission, then completion verified.

Final snapshot: Claude ACP Ready, exact original session UUID retained, prompt_queue true, limit16 and zero queued prompts. Same host/session/window/pane, card name/notes/color/pin verified, all other local pane PIDs unchanged across each handoff. Private journal .local/reviews/coordinator-queue-upgrade.json retains both completed legs and verified-not-sent attempt with opaque IDs. No chat prompts, tool approvals, auth/trust answers, new/forked conversation or repeated uncertain IO. No CC backend restart, install, commit or push.

This also exercises the corrected real-Claude session/load path through the coordinator's existing history after the historical-image frame-limit fix. It does not test real provider queue dispatch, cancellation or image pixel comprehension; those were not part of the human-approved scope and no test prompt was sent. Old historical checking receipt remains recovered from task0095; new handoff receipts are complete/not_sent only.
