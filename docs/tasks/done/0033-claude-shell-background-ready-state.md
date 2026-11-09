# Task 0033: Claude shell state with idle foreground

Owner: CC dev
Claimed: 2026-11-08
State: done

## Goal

Recognize native Claude registry shell as idle foreground with background shell work, retaining separate background-task observations and all process/session/timestamp checks.

## Findings

Reported live agent is process-linked but Unknown because status=shell is unmapped. Read-only native implementation inspection confirms shell is derived from idle foreground plus background shell state. Terminal inspection corroborates idle prompt/background work, but is not status authority. Do not map shell to Working or derive completion from text/log silence.

## Validation

- New shell-state regression fails before fix, passes after. Foreground continuation checks (14), native history (34), background tasks (7) and guarded outbox (7): 62 Python tests pass. Covers unknown/future states, wrong process start, stale/invalid timestamps, newer foreground work and sidechain completion guards. Existing SQLite ResourceWarnings remain in history fixtures.
- Formatting, Clippy -D warnings, release build and 44 Rust library tests pass. Listener tests run outside the restricted network sandbox. No frontend source changes; no frontend build needed.
- Deployed backend with exact prior args/environment, verified unchanged source/config hashes and original local panes before remote verification. Same remote agent instance and native conversation remain process-linked. Initial expected-Ready assertion raced with actual new foreground work; follow-up confirms valid claude_events Working and all four access paths healthy.
- A previously human-queued message for this same process/conversation became Seen through the existing guarded worker after association/readiness recovery. No manual message, replay, approval, log edit or native agent restart. Background task evidence was not promoted to completion.

## Handoff

The reported card no longer has an unsupported native state; it is currently Working on its new turn. Shell maps to foreground Ready only after normal native identity/timestamp validation, while separate background-task observations retain their own uncertainty. No blanket fallback for unknown provider states. Older idle-like shell registry timestamps need not imply active foreground work or freshness of a background job.

Prior uncommitted Board/List/style work preserved. Changes uncommitted. Next task 0034, bug 0020.
