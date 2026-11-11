# Task 0046: Ticket Review state

Owner: CC dev
Claimed: 2026-11-10
State: done

Add explicit review status across Board columns, list filters, ticket editing, REST validation/OpenAPI and coordinator helper. Preserve existing statuses, revisions and launch behavior. Validate persistence, stale writes and desktop/mobile navigation using isolated fixtures.

## Implementation and validation

Added review to backend save/move validation, the shared frontend status list (Board column, editor, list badge and filter), OpenAPI Status enum and coordinator CLI move choices. Review has an accent-colored list badge. Existing SQLite ticket JSON needs no migration; ticket identity/revision and launch guards are unchanged. No automatic agent or ticket transitions were added.

- cargo fmt --check and cargo clippy --all-targets -- -D warnings pass; cargo build --release passes.
- cargo test --lib board::tests: 6 passed.
- CC_BINARY=target/release/command-center python3 -B tests/test_openapi.py: 6 passed. Review creation, edit, moves, list/detail and restart persistence validated with synthetic tickets; stale revisions rejected; coordinator CLI accepts review. No launch receipts created.
- npm run build -- --outDir dist-next passes with existing bundling warnings.
- npx playwright test tests/ticket-layout.spec.ts: 7 passed, including new desktop/phone Review column/editor/filter/reload coverage with zero terminal sockets.
- git diff --check passes. Deployed backend and staged frontend while retaining prior hashed assets and exact runtime argv/environment/listeners. All four access paths healthy; configuration and canonical tmux pane/PID snapshots unchanged; live served OpenAPI includes review.
- No live tickets modified, no messages/approvals/launches, no native agents restarted.

Next task 0047; next bug 0027.
