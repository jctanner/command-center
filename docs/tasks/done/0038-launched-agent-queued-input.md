# Task 0038: Launched agent queued input

Owner: CC dev
Claimed: 2026-11-08
State: done

Investigate queued input to coordinator-launched agents, starting with the reported ticket. Preserve receipts/process identities and never replay uncertain delivery. Identify evidence gap, add regression coverage and deploy a bounded fix.

## Findings and change

Automatic approval review keeps a guardian thread writer/open log in the same native Codex process as the main user thread. Both were marked linked, so live status/outbox observation rejected their ambiguous association. The existing queued intent already referenced the correct root log hash; no receipt retarget was needed.

Exclude session metadata explicitly marked source.subagent, source=subagent, or thread_source=guardian_review/subagent during bounded conversation discovery. Preserve unknown/legacy sources, ordinary user forks, process ownership checks and genuine multi-root ambiguity. Guardian inherited session_id/parent metadata is not main-thread identity. Native logs remain unchanged. Root lifecycle evidence alone drives Ready/Working and outbox matching. No grant, delivery or approval guards loosened. See bug 0020.

## Validation

- Three guardian tests pass with actual kernel-owned root/guardian locks and open logs. Cover unique root linkage/Ready/outbox log identity, child completion versus Working parent, genuine-root ambiguity, provider markers versus human forks/legacy. Simulating old metadata behavior fails two regression tests, confirming reproduction.
- Existing Python history 34, outbox 7 and activity 5 tests pass (49 Python checks total with the three new tests). Existing SQLite ResourceWarnings observed in history tests.
- Four Playwright outbox integration checks pass in 30s: FIFO/restart/idempotency, uncertainty no-replay, replacement/endpoint isolation and new launched guardian/root writer fixture with Queued→Submitted→Seen exactly once.
- 44 Rust library tests, formatting, Clippy all targets with -D warnings and debug/release builds pass. git diff --check passes. No frontend change/build needed.
- Read-only patched observer against the affected live process proves unchanged instance, correct original root hash and verified Ready before deployment.

## Deployment and recovery

Gracefully restarted only the CC backend with exact prior argv/environment. All four access paths healthy; configuration hashes and original local pane PIDs unchanged. Remote native agent was not restarted. The original user-queued receipt progressed to Seen through the normal worker, retaining its UUID, text, endpoint/target/process and conversation; same agent now reports verified Working. No manual resend, force-submit, receipt release/archive, new agent launch or tool approval. Private evidence under ignored .local/reviews; no private runtime details in tracked records.
