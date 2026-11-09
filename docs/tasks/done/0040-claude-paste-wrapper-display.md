# Task 0040: Claude paste wrapper display

Owner: CC dev
Claimed: 2026-11-09
State: done

Hide only exact Claude transport paste wrappers backed by a same-process/conversation Seen receipt and exact original text. Preserve raw native logs, cursors, receipt hashes and unmatched/literal XML. Cover delayed receipt arrival and false matches in frontend tests.

## Cause and implementation

Claude long-paste transport stores matching pasted_content envelopes in a human record. Native input hashing already recognizes the wrapper for exact receipt confirmation, but chat displayed native text verbatim. The reported message has a same-process/conversation Seen receipt proving the submitted inner text.

Frontend display cleanup now requires Claude provider, a complete single matching hexadecimal-ID wrapper, no nested wrappers, exact native seen_message position, same target/process/conversation and normalized inner text matching the original receipt text. Display the receipt’s exact original text (including whitespace) through textContent. Reconcile when receipts arrive after history, including unchanged-history polls. Raw API messages/logs, native cursors, input hashes, delivery and activity remain untouched. Other providers, intentional wrappers submitted as literal input, embedded/malformed/nested tags, wrong scopes and missing evidence stay literal.

## Validation and deployment

- Three new provider-specific browser tests pass in 22.8s. Cover delayed Seen receipt arrival, original whitespace/HTML-as-text, literal exact wrappers, mismatched closing IDs, embedded/nested wrappers, wrong process/conversation and no receipt. Codex/pi remain unchanged. Initial fixture used an unavailable compact toolbar selector; corrected it to wait for ordinary receipt polling.
- Three existing outbox/browser regressions pass: old Seen receipt suppression, delayed-history one-bubble handoff and fast-confirmation handoff.
- Seven existing native outbox Python tests pass, including raw pasted-history/hash preservation.
- TypeScript/Vite build and git diff --check pass; existing bundling warnings only. No Rust/backend changes or rebuild needed.
- Frontend deployed with prior assets retained and atomic index update. Live compact-browser inspection confirms the reported bubble equals exact original receipt text, transport tags hidden and zero message/approval/launch actions. Screenshot and native evidence remain ignored/private under .local/reviews. No backend/agent restart, log rewrite, resend or live ticket changes. Reload open clients.
