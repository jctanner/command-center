# Task0096: Durable ACP busy-time prompt queue

Owner: CC dev; claimed2026-11-17; State: done (deployed in task0097).

Human requested ACP busy-time queuing. Add a per-broker-instance, exact-session FIFO of explicit prompt intents. Accept Ready/Working/Approval; submit one session/prompt at a time only when Ready, no pending permissions or uncertain receipts.16 entries,12000 UTF-8 bytes each,24h expiry. Persist queued text privately only until claim/cancel/expiry; retain metadata-only UUID receipts. Browser/backend disconnect must not lose broker-owned queue; changed broker instance must not replay queued/claimed/uncertain input. Show queued/submitted states on a single bubble, allow cancel-before-dispatch, preserve drafts, require capability for older brokers. No automatic broker upgrade/restart/deploy or live-provider test.

## Implementation

- Explicit prompts are accepted into per-broker-instance/session FIFO while Ready, Working or Approval after session creation/load completes. Exactly one provider session/prompt is active; callbacks dispatch the next only after current completion, with no pending permission, claimed/uncertain/failed send or unavailable state. This is next-turn queuing, not provider steering/concurrent prompting.
- Private SQLite pending intents:16 entries,12000 UTF-8 bytes each,24h expiry. Receipt UUID/digest is durable before acceptance, queue state/text durable before queued response. Text is deleted with secure_delete before durable claim/adapter IO or cancellation/expiry; receipts retain no text. Different broker instance/session blocks rather than replays. Startup orphan handling occurs only after exclusive ownership, so duplicate startup cannot erase a live queue. No extra worker/remote daemon.
- cancel_queued has its own UUID and exact queued prompt target; lock serializes cancellation against claim. Cancel turn affects active turn only. Explicit Close warns and cancels remaining queued intents before adapter shutdown. Provider failure/uncertainty holds later queued prompts, which remain cancellable/expirable.
- Capability-gated UI enables sends while working/approval only for supporting loaded brokers. Stable user bubble with queued/submitted/held/withdrawn states, spinner and cancel-before-dispatch. Active assistant chunks remain one turn/message despite inserted queued bubbles. Lost acknowledgements reconcile original receipts/snapshots; proven pre-claim capacity/state rejection keeps the draft without an uncertain-delivery barrier. Other errors remain held, never resent. Queued text and chat snapshots remain bounded.
- Expanded typed API/OpenAPI receipt states, cancel_queued command and optional queue capability/count/held fields; bounded receipt recovery includes queued/outstanding prompts. Older brokers remain supported read-only/Ready sending, no implicit hot-patch/restart. Handoff allows cancelled/expired unsent prompts but rejects queued/uncertain ones. Updated reference/ADR/AGENTS.

## Validation

- Frontend TypeScript/Vite build passed (existing bundle-size advisory); cargo fmt --check and git diff --check passed.
-41 ACP Python tests passed: FIFO, duplicate UUID/digest, Working/Approval queues, cancellation, no false queue-full receipt, expiry/limit, wrong instance/session, uncertainty/failure hold, duplicate-owner protection, bounded snapshots/preserved pending intents and active reply chunk continuity; existing large-image/permission/native-resume guards retained.
-11 mode-helper Python tests passed, including queued/uncertain barriers and cancelled/expired handoff eligibility.
-92 Rust library tests and Clippy all-targets -D warnings passed; six served OpenAPI tests passed.
-28 ACP/mode-switch Playwright regressions passed on isolated debug backend. Two mobile queue checks were strengthened and rerun against debug and final release: fake Claude/Codex Working turn, lost queued acknowledgement, single bubble, cancel only unsent follow-up, browser reload and CC backend restart while broker remains alive, eventual FIFO dispatch, no duplicate requests, explicit close cancels queued text. Final release two passed. No real providers/SSH hosts exercised.
- Initial busy browser check exposed cancel buttons left disabled after a request; controls now refresh queue-action enablement. Completed final suites pass. Prior load-time approval test now verifies that queuing after load completion preserves approval instead of rejecting it. IO failure still persists uncertainty and raises, never retries.
- Logs .local/acp-queue-{python,mode,rust,clippy,web,contract,browser-final,restart-browser,release,release-browser}.log.

## Handoff

No deployment, commit/push, real-provider launch/input, live-agent restart or migration. Last deployed service remains task0095's recovered-receipt fix; existing live ACP brokers do not gain queue capability until explicitly replaced/resumed with approved scope. Future deployment must preserve current listeners/env/config and pane PIDs, inspect pending switch/restart/send/queue receipts and never replay them. Queues live in tmux-owned brokers and survive backend restart; installing a backend release is not permission to stop brokers. Native remains default. Real-harness/remote queue behavior remains unverified beyond protocol fixtures.

## Subsequent release

Human authorized commit all/push/deploy. Implementation f1ce21c deployed2026-11-17 14:23:48 UTC; task0097 records verification. Four access paths/contract/index/running binary healthy, runtime/env/config/local tmux pane PIDs unchanged. No existing broker restarted or patched. Earlier staged-status notes above describe the implementation checkpoint, not current deployment state.
