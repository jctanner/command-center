# Bug 0004: Claude internal XML records appear as human chat

State: fixed
Fixed: 2026-11-04
Found: 2026-11-04

Native task notifications have promptSource=system, turnOrigin=task_notification and origin.kind=task-notification; compaction summaries have isCompactSummary=true. These are user-role records without isMeta, so the old filter displays them as You and includes them in receipt evidence. Filter explicit provider metadata, never XML-looking content alone. Preserve genuine human XML and assistant replies.

Work: [Task 0008](../../tasks/done/0008-claude-internal-chat-records.md).

Resolution: explicit Claude internal-user metadata filter, tested with real-human XML retained and internal records excluded from receipt evidence. Deployed and live verified.
