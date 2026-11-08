# Bug 0017: Resumed Codex links incidental threads

State: fixed
Reported: 2026-11-08

A resumed Codex process can retain a writer lock/open rollout for a different startup thread. CC marks both it and the PID/start/boot/pane/cwd-validated runtime session as linked, leaving association none and status unknown. Re-registering alone cannot fix the evidence union. Prefer the verified runtime registration consistently; retain existing ambiguity safeguards when registration is absent/invalid. See [Task 0029](../../tasks/done/0029-codex-resume-session-precedence.md).

Validated with conflicting kernel-lock/open-log/resume fixtures and live read-only verification. Exactly one current conversation is linked; the affected queued intent now waits only for verified Ready. No native process/log/receipt replacement.
