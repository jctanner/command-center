# CC-75 absorbed-input confirmation

Human reported outbox sync. Exact original process/native log metadata shows the last message was consumed mid-turn, represented as a human queued_command attachment paired to remove(reason=absorbed_mid_turn), not a normal user record. Old parser skipped it. Four earlier receipts already Seen; latest still Submitted.

Narrow staged parser recognizes explicit same-session human delivery provenance and projects only original prompt/digest at the attachment offset, preserving receipt process/inode/post-baseline/one-use guards. Excludes rendered system/request context and arbitrary/queue-only/sidechain/ambiguous records. Visible-history prefix v4 resets old caches without changing native reply cursors. Read-only live proof and isolated fake-Claude integration passed; no live input or receipt edits.

[Task0073](../tasks/done/0073-cc75-outbox-sync.md), [bug0038](../bugs/fixed/0038-claude-absorbed-input-unconfirmed.md) contain validation. Release binary and .local/deploy-claude-absorbed-input.py are staged. Explicit backend deployment approval was requested and is pending; do not infer it from the earlier frontend approval. After deployment, read the same original receipt for normal Seen reconciliation without resend. No commit/push requested. Private evidence contains metadata/fingerprints only, no full transcript snapshot.


## Subsequent approval and verification

Human approved deployment. Backend release applied with four health paths/SSE/contracts healthy and configuration/tmux pane PIDs unchanged. Original receipt automatically Seen at native offset5187429; same process/conversation, one native user row, v4 visible history. Read-only compact UI has no pending duplicate, errors or terminal sockets. No resend, native restart, manual receipt mutation, commit or push. Earlier deployment gate is resolved.
