# Codex resumed-session identity

A restart/resume left multiple process-linked threads (runtime registration plus incidental writer/open log/startup argument), blanking history/status and holding queued delivery. Prefer the valid PID/start/boot/pane/cwd runtime registration; retain fallback guards when invalid/missing. No native process, session, log or queued intent was replaced.

53 Python checks, 44 Rust library checks, formatting/Clippy/release pass. Two socket tests needed execution outside the restricted network sandbox. Backend deployed preserving args/environment/config and original panes. Live current agent has one matching linked session, restored history and Working state. Its original queued message now correctly waits for this turn to finish; never manually replayed or moved across instances. Old blocked receipts unchanged.

See [Task 0029](../tasks/done/0029-codex-resume-session-precedence.md) and [Bug 0017](../bugs/fixed/0017-codex-resume-links-incidental-threads.md). Prior uncommitted work preserved. Task 0009/Board sync pending unchanged. Next task 0030, bug 0018.
