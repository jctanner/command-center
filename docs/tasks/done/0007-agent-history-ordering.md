# Task 0007: Agent message ordering and duplication

Owner: CC dev
Claimed: 2026-11-04
State: done
Completed: 2026-11-04

## Goal

Investigate the reported corsair breadboard-main conversation ordering/duplication; reproduce with synthetic fixtures, fix verified causes and deploy. Preserve delivery evidence and never resend messages.

## Findings and fix

The affected native input was a single Claude pasted_content wrapper with matching hexadecimal IDs. Its inner contents exactly matched an existing submitted receipt. Hashing the wrapper prevented reconciliation; the frontend displayed that pending copy after native replies. Native message IDs were unique and ordered.

Normalize only this entire matching-ID wrapper for Claude user-input confirmation. Reject nested, partial, prefixed/suffixed or mismatched wrappers. Preserve literal transcript text and cursors. Other providers are unchanged. Process, log inode/device, post-submission offset, one-use receipt and archived ambiguity checks remain intact. No messages resent or transcript records rewritten.

## Validation

Synthetic regression failed before the change and passes afterward, including outbox-status evidence while working, malformed/nested wrapper rejection and Codex literal handling. 38 agent Python tests and 8 Claude continuation tests passed; three Rust outbox safety tests passed. Browser confirmed-old-receipts regression passed (6.7s). Release build and diff check passed.

Deployed backend with existing listener/origin arguments. A read of the reported conversation reconciled its existing receipt to Seen at the correct native position; native IDs remained unique and ordered. HTTPS healthy. Existing frontend hides Seen receipts on refresh; no frontend change was needed.

## Handoff

Next chat poll removes the duplicate receipt. Reload app if necessary. Other unsupported provider transformations remain unconfirmed rather than guessing acceptance. See [bug 0003](../../bugs/fixed/0003-claude-pasted-input-duplicate.md). Next task: 0008; next bug: 0004.
