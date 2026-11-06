# Bug 0006: Restart recovery tied to an ephemeral connection revision

Found: 2026-11-05
State: fixed
Fixed: 2026-11-05

A synthetic lost-response/reload test exposed that a CC backend restart refreshes connection revisions. A browser receipt key including that revision hid the outstanding operation, and status verification rejected an unchanged endpoint. Use a pane-scoped opaque operation ID and the durable endpoint fingerprint for recovery. Keep fresh-revision validation for preparation/start; status checks never repeat mutations.

[Task 0010](../../tasks/done/0010-restart-agent.md)

Resolution: stable endpoint fingerprint for status reads plus pane-scoped opaque browser receipt ID. Lost-response/reload/backend-restart regression passes with one restart POST; stale action revisions remain rejected.
