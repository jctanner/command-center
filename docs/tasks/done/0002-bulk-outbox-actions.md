# Task 0002: Bulk Outbox cancellation and archiving

Owner: CC dev
Claimed: 2026-11-04
State: done (directory is authoritative)
Completed: 2026-11-04

## Goal

Let the user cancel all eligible queued messages and archive all eligible receipts from the global Agent Outbox, including on mobile.

## Acceptance criteria

- [x] Separate cancel-all and archive-all controls preview counts across all machines and all stored receipts, including older receipts outside the visible recent page.
- [x] Confirmation binds an exact eligible snapshot; concurrent changes reject the batch atomically instead of partially applying it.
- [x] Cancel only queued/blocked records; never cancel submitting/submitted input. Archive obeys existing eligibility, clears stored text, and preserves idempotency/delivery evidence.
- [x] Uncertain/submitted archiving and possible queue unblocking are clearly disclosed. Browser-only receipts remain for individual review.
- [x] No sending, approvals or automatic retry occurs in bulk handlers. Tests use isolated fixtures only; actual worker delivery guards remain unchanged.
- [x] Mobile layout, changed snapshots, old receipts, persistence and unchanged terminal output are verified.

## Files likely involved

src/outbox.rs, web/src/agent-outbox.ts, web/src/style.css, web/tests/outbox.spec.ts, docs/reference/features.md.

## Findings

The current list shows all unresolved receipts plus 100 recent settled receipts. Bulk scope must include older stored records, not merely the rendered list. Existing per-record actions use revisions/CAS; the worker commits Submitting before terminal IO. A transaction with a reviewed snapshot can preserve that boundary without SSH requests.

## Validation evidence

- `cargo test --offline`: 35 library tests, 2 binary tests and 2 tmux integration tests passed.
- `cargo clippy --offline --all-targets -- -D warnings`, `cargo fmt`, and release build passed.
- `npm --prefix web run build -- --outDir dist-next` passed.
- Release-backed `web/tests/outbox.spec.ts`: all 13 passed, including changed snapshot rejection, transaction rollback on injected storage failure, 141 receipts across machine scopes, persistence/idempotency, phone confirmation/browser-only retention, and uncertain lost-response behavior.
- After final dialog spacing, the focused mobile bulk test passed; reviewed the phone screenshot for contained layout.
- Deployed backend/frontend and verified both preview endpoints through HTTPS using GET only. No live bulk cancel/archive action was performed.
- `git diff --check` passed before deployment. Final record links are checked after moving this task.

## Next action

Implementation complete. User can reload the app and choose Cancel all queued or Archive all receipts from Outbox. No additional work is required for this task; live CC Board tickets were not changed.
