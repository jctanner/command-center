# Task 0009: Pi first-message receipt confirmation

Owner: CC dev
Claimed: 2026-11-05
State: current

## Goal

Prevent first-message receipts sticking when Pi has not persisted a log yet. Capture a verified empty-session identity before dispatch, preserve all existing delivery guards and never infer a legacy missing baseline from matching text. Current legacy receipt archival requires the pending user choice.

## Implementation

Persist the bridge-verified empty Pi session UUID before claiming/submitting input, only with no leaf and no existing session file. Existing logs retain device/inode/byte baseline matching. A later linked log must report that exact Pi UUID; confirmation still needs the exact input digest on the active branch and an unused position. Store the observed file baseline and conversation after first confirmation so later receipts cannot reuse it. Preserve archived ambiguity guards and default new fields for old database records.

## Initial validation

Pre-fix empty-session fixture failed; 41 agent Python checks now pass. All 37 Rust library tests and Clippy -D warnings pass; release build passed. Three focused browser/FIFO checks passed (31.8s): lazy-log first-message confirmation/release of next queued input, normal busy/restart/FIFO flow, and old Seen receipts staying out of chat. The affected old receipt has no pre-send identity, so it remains Submitted unless the user explicitly chooses archive.

## Deployment and pending user action

Deployed 2026-11-05 using existing backend arguments; HTTPS healthy. No live input sent. The legacy first receipt remains Submitted, unchanged and never retried. A pending user question requests permission to archive only that receipt, keeping its evidence and unblocking FIFO. Do not treat elapsed time as approval or infer Seen from matching text without a pre-send anchor. Implementation is complete; keep this task current until the requested receipt-review choice is handled.

## Handoff

On explicit archive approval, read current receipt revision and consult ignored .local/operations.md for the exact original receipt ID and use the normal revision-guarded archive API for that receipt only. Do not guess or substitute any identifier. Verify status Archived, no resend, then complete this record and bug 0005. If user declines, retain it and record that choice. Next task number: 0010; next bug: 0006.
