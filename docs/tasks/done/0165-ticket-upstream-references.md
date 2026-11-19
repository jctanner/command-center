# Task0165: Multiple upstream ticket references

Claimed2026-11-19 by CC-dev. Human wants Jira-first external upstream ticket references, also GitHub/other trackers. Add bounded label/key and optional HTTP(S) URL entries, revision-safe persistence and editable links in ticket details. Old clients omitting the field preserve existing values. No upstream API requests or write integrations. Validate Rust/API and responsive ticket UI.

## Completed2026-11-19

Tickets persist upstream as up to20 label/key + optional HTTP(S) URL references in existing JSON rows. Default empty for legacy tickets, omitted update preserves existing values, explicit [] clears. Revision guards unchanged. Labels200 bytes, URLs2048 bytes, unsafe schemes/credentials/control/whitespace rejected. No schema migration or upstream network operations. OpenAPI and ticket API reference updated.

Ticket editor has add/edit/remove rows and safe external links in its main detail area, responsive wrapping and optional URLs; launch prompt includes refs.

Validation: cargo fmt --check; cargo test board::tests (16 passed); cargo clippy --all-targets -- -D warnings; cargo build; frontend TypeScript/Vite build passed. All9 ticket-layout Playwright cases passed; two focused cases re-run after adding edit/remove/key-only coverage. Verified multiple references, safe links, legacy omission preservation, explicit clear, stale409, unsafe/oversized400 and desktop/mobile overflow. Logs .local/upstream-tickets-{rust,clippy,build,web,browser,edit-tests}.log. git diff --check passed. No deployment, commit, tracker writes or live ticket edits.
