# Task0095: Resolve a recovered connection-mode receipt

Owner: CC dev; claimed2026-11-17; State: done.

Human remains blocked switching recovered coordinator. Add explicit metadata-only resolution of checking native→ACP receipt after exact native process/conversation recovery and proof original broker/adapter exited. Preserve original attempt, distinct recovered state, endpoint/process guards and ordinary outbox barriers. No auto retry or implicit conversion. UI clears only recovered receipt cache and performs fresh preparation for separately confirmed switch. Tests cover stale/live/wrong conversation/endpoint and ordinary guards. Finish prior authorized deployment with process survival checks, resolve only human-reported coordinator receipt after backend verification; no automatic conversion.

## Implementation

Added GET/POST connection-mode-recover and recovered receipt state. Read-only GET finds one checking native→ACP receipt for current stable endpoint and exact session/window/pane, verifies native process/session recovery and original broker/adapter exit before exposing it. Explicit POST revalidates endpoint, current process identity, provider/project, exact persisted conversation (Claude validated continuations supported), original broker intent/target and exited broker/adapter. It retains the original receipt/plan and records recovery process/session/time; no terminal input, restart, mode switch or replay occurs. Only this metadata barrier is resolved; outbox/answer barriers remain. Repeated same-target resolution is idempotent; the original switch cannot run again.

UI offers Resolve recovered switch even when the old broker's status endpoint errors; it can discover the receipt after local cache clearing. Recovered status clears only the opaque obsolete receipt reference and performs fresh preparation, with a separate Switch confirmation and Cancel focused. Pending status polls are invalidated during resolution. OpenAPI and reference docs updated.

## Validation

Ten Python mode-helper tests passed: live old broker/adapter, wrong/stale/replaced native process and wrong conversation reject; exact recovery succeeds without mutation.92 Rust tests, Clippy all-targets -D warnings, frontend TypeScript/Vite build, six served OpenAPI tests and formatting/diff checks passed.26 mode/ACP Playwright tests passed, including saved/cleared-cache failed-load→native-recovery→explicit-resolution→fresh-review flows, stale connection/target/process rejection, idempotency, original receipt no-replay and unchanged native PID/no automatic switch. Initial fixture snapshot query used an unsupported instance parameter; corrected. An initial browser run also exposed resolution hidden after old-broker status failure; corrected before final full pass. Logs .local/recovered-switch-{python,rust,clippy,web,contract,browser-final,release}.log.

## Deployment and reported receipt

Completed the human's ongoing deployment correction at2026-11-17 13:34:56 UTC. Four access paths, initial SSE, full served contract, frontend index and running binary verified. Exact runtime arguments/environment/configuration and canonical tmux pane PIDs unchanged. Preflight read-only exception verified the previously authorized native recovery against the historical checking receipt; no audit row was rewritten by deployment. Private receipt .local/reviews/recovered-switch-deployment.json.

Then resolved only the human-reported coordinator receipt through the new guarded API. Status now recovered; fresh native→ACP preparation returned prepared. No switch confirmation, agent input, restart, conversation creation or old attempt retry occurred. cc-coordinator remains native. Audit .local/reviews/coordinator-switch-receipt-resolved.json; old receipt retains original attempt and added recovery proof. All clients can clear obsolete local references by reloading and checking recovered status. Future deployment preflight no longer needs an exception for that original checking receipt. No commit/push requested or performed; real coordinator ACP reattempt remains the human's separate choice.
