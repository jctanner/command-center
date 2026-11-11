# Task 0048: Agent composer message recall

Owner: CC dev
Claimed: 2026-11-10
State: done

Add Up/Down recall scoped to active machine/process/conversation, preserving multiline cursor movement, modifiers, IME, unsent drafts, polling and guarded explicit send. Reuse loaded native human messages and current pending outbox entries without new persistent history. Validate with browser fixtures.

## Implementation and evidence

Unmodified Up on the first logical line recalls older messages; Down on the last logical line advances and restores the saved unsent draft. Selection, modifier arrows, IME and readonly/disabled composers retain native behavior. Editing recalled text makes it the new draft. Switching agent/process/conversation/branch restores the original draft and resets recall; polling retains the current position.

Reuse up to 50 complete, send-size-valid loaded native human messages and scoped queued/submitting/submitted outbox texts. No extra persistent transcript or history requests; truncated messages and uncertain/cancelled/archived receipts are not added. Proven Claude pasted envelopes use existing receipt-backed display normalization. Recall only edits the textarea; Enter still uses existing explicit send guards.

- TypeScript/Vite staging build passed, existing bundle warnings. An initial npm build invocation from repository root failed because package.json lives in web; corrected invocation passed.
- Eight final browser tests passed (17.9s): two desktop/mobile recall scenarios plus four file-handoff and two connection-error regressions. Recall cases cover ordering/bounds, ignored assistant/truncated messages, multiline/modified arrows, IME, saved and edited drafts, polling, conversation isolation, pending receipt recall and readonly attention state, with zero writes/terminal sockets.
- Initial recall test timed out selecting a hidden conversation picker; opening Details corrected the fixture. Both scenarios then passed, including expanded receipt coverage.
- git diff --check passed. Frontend published retaining prior hashes; live index matches staged build. No Rust changes/backend restart, live agent input, ticket mutation or native process changes.

Limitation: recall covers the currently loaded history (including explicitly loaded older pages), capped at 50 entries, rather than fetching the entire conversation. No recalled text is sent automatically.

Next task 0049; next bug 0028.
