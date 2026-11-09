# Bug 0019: Claude shell registry state becomes Unknown

State: fixed
Reported: 2026-11-08

A verified Claude process reports status=shell when idle foreground has background shell work. CC only maps idle/busy/working and selected permission states, so cards become Unknown despite valid registry/session evidence. Preserve separate foreground/background semantics, stale/future evidence checks and identity guards. See [Task 0033](../../tasks/done/0033-claude-shell-background-ready-state.md).

Resolved by explicit shell-to-Ready foreground mapping with a background-work reason, preserving all event/identity/time guards. Validated with failing-then-passing native fixtures and live same-process status/receipt checks after deployment.
