# 2026-11-04: Bulk Outbox actions

Agent: CC dev

## Completed

[Task 0002](../tasks/done/0002-bulk-outbox-actions.md) adds global cancel/archive controls with reviewed full-database counts, exact revision snapshots and atomic transactions. Cancel excludes claimed/submitted input; archive clears text while preserving UUID/digest/baseline evidence. Browser-only receipts remain for individual review. Frontend receipt ingestion batches rendering rather than redrawing for each receipt.

## Validation and deployment

Rust tests (35 library / 2 binary / 2 integration), formatting, Clippy, release/frontend builds, 13 outbox browser tests and the final focused phone-layout test passed. Checks cover changed snapshots, injected rollback, older receipts outside the recent page, other machine scopes, no extra terminal input, restarts, uncertainty and response loss. Deployed backend/frontend; HTTPS previews verified with GET only. No live bulk action or Board-status change was performed.

## Handoff

The user needs Reload app to obtain the controls. Both actions confirm their full counts and consequences. Preserve the dispatch boundary and archived evidence on future changes. The next repository task number is 0003; other record-type counters are independent.
