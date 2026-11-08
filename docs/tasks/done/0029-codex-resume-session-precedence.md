# Task 0029: Codex resumed-session evidence precedence

Owner: CC dev
Claimed: 2026-11-08
State: done

## Goal

Restore unique current conversation association after a Codex restart/resume leaves another thread writer/open log under the same process. Prefer the validated runtime session registration, preserve all identity guards and leave native processes/logs untouched.

## Findings

The reported restarted process has two linked candidates despite a valid registration. process_sessions unions its registration with writer locks, and conversations additionally unions open logs/startup resume arguments. Explicit runtime registration must supersede stale incidental evidence. No newest-log or cwd inference.

## Validation

- Regression reproduces two linked sessions using a real kernel-owned writer lock, an open incidental rollout and conflicting startup resume argument, plus valid private runtime registration. Failed before fix, passes after. Invalid boot identity falls back to existing process evidence rather than trusting the registration.
- History (34), outbox (7) and Claude continuation (12) Python checks pass. Existing SQLite ResourceWarnings remain in history fixtures. Formatting, Clippy -D warnings and release build pass. Rust library suite passes all 44 outside sandbox after two listener-binding tests were initially blocked by workspace sandbox networking.
- Backend deployed with exact prior args/environment; original tmux pane processes and source/config hashes preserved, four access paths healthy. Read-only live verification shows exactly one linked native session matching current runtime ID, association=process, correct history and Codex Working evidence.
- The reported queued receipt belongs to the current process/conversation. Before fix it was waiting for process linking; after fix it remains safely Queued with reason waiting for the current turn to finish. No manual submission, replay, process transfer, receipt edits or agent restart performed. A separate old-process blocked receipt remains untouched.

## Handoff

Runtime session registration now supersedes incidental writer/open-log/startup evidence. Without valid registration, prior evidence and ambiguity safeguards remain. No frontend/transport changes or asset rebuild needed. Current queued message can dispatch through the original guarded worker once this turn reaches verified Ready. Changes uncommitted; prior work preserved. Task 0009 and interrupted Board sync remain unchanged. Next task 0030, bug 0018.
