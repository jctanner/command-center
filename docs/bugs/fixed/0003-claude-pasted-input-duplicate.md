# Bug 0003: Claude pasted input remains duplicated below replies

State: fixed
Fixed: 2026-11-04
Found: 2026-11-04

Claude stores a long user input inside matching pasted_content id wrappers. Its contents exactly match a submitted receipt, but raw input hashes differ. Receipt stays Submitted and the frontend appends it after native replies. Native messages have distinct IDs; this is an unreconciled receipt, not duplicate delivery. Preserve transcript content, process/log/cursor/one-use guards and never resend.

Work: [Task 0007](../../tasks/done/0007-agent-history-ordering.md).

Resolution: strict Claude-only full paste-wrapper normalization for confirmation hashes. Regression and receipt-safety checks pass; live existing receipt reconciled without a resend. Native transcript remains unchanged.
