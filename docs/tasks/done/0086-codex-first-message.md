# Task0086: Codex first message before transcript persistence

Owner: CC dev; claimed2026-11-16. State: done (implemented and verified; not deployed).

Human reproduced a fresh native Codex launch after skipping update: CC chat starts working only after first terminal message. Discover the native pending UUID through exact process/start/kernel writer ownership; never use another project conversation. Permit explicit first input through the same one-use process/screen/endpoint guards, retain durable UUID and eventual same-session receipt matching, without inventing Ready or auto-sending prompts. Show awaiting-first-message state and avoid suggesting stale project history. Preserve project-history browsing but make it separate from current agent input. Existing switchme process is read-only diagnostic scope; do not send, restart or recreate it. Fixture tests, no deployment without request.


## Delivered

Fresh Codex sessions expose their verified pre-transcript UUID and a conservative empty-editor capability separately from activity: New session/Unknown, never invented Ready. One-use grants bind UUID/process/screen; durable outbox records retain the UUID and original screen before first submission. Changed editors or sessions block; receipt confirmation after materialization requires the same native UUID and cannot match older project history. Old records deserialize safely. Explicit history browsing remains separate, with sending disabled for older history during initial bootstrap; the UI follows the proved thread once persisted.

No artificial initial prompt, update answer, source configuration edit, hook or agent restart is used. The supported initial input boundary matches the observed native Ask Codex to do anything / ? for shortcuts layout; other layouts remain unavailable pending explicit inspection. The existing unknown-status/manual-submit and native busy/ready guards remain intact.

## Validation

- Frontend TypeScript/Vite build and Rust release build passed; all-target Clippy with warnings denied passed.
-92 Rust library tests passed, including first-input same-thread receipt matching, wrong-thread rejection, used-position exclusion and legacy record compatibility.
-35 Python history tests,7 busy-input tests and7 native outbox tests passed. New tests use actual kernel-owned fixture writer locks and reject unlocked/stale identities, typed drafts and startup menus. An initial test fixture had an invalid UUID/newline literals; corrected, then all35 passed.
- Six served OpenAPI checks passed against the release artifact.
-11 release Playwright regressions passed: desktop/mobile first-message bootstrap, changed-editor blocking, automatic live association after terminal first input while viewing older history, project counters, queue/restart/idempotency/uncertainty/endpoint guards and pi lazy-log receipts. New first-message tests require zero terminal WebSockets and exactly one persisted input.
- Read-only isolated backend against the human's existing switchme2 verified normal process association after its transcript existed; zero messages/restarts. This is not a live first-message delivery test. Original switchme was killed by the human during inspection; it was not recreated.

## Related installation and handoff

Human subsequently reported missing Codex ACP adapter on corsair. Installed pinned @agentclientprotocol/codex-acp2.7.0 only in the isolated CC adapter prefix with npm install scripts disabled; package/executable and unchanged native Codex hash verified. No agent launched/restarted/converted. ACP requires this adapter, native mode does not; this installation is separate from the native first-message fix.

Task0086 has not been committed, pushed or deployed. Bug0043 is fixed in code with pending deployment; bug0042 (updater menu surfacing) remains open and requires manual native skip. Preserve existing native/ACP agents and listener flags during a later approved deployment. No live ticket statuses or other agents changed.
