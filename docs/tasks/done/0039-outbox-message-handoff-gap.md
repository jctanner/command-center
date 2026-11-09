# Task 0039: Outbox message handoff gap

Owner: CC dev
Claimed: 2026-11-09
State: done

Retain an already-visible pending message during receipt Seen→native-history handoff. Remove it only when its exact native replacement is rendered. Do not resurrect old Seen receipts, duplicate bubbles, infer matching from text, or alter delivery. Add delayed-history browser coverage.

## Cause and implementation

AgentOutbox.inline dropped every Seen receipt immediately, independently of native history polling. The backend could confirm delivery while the displayed conversation page still omitted the user message. Retain IDs only for pending bubbles already shown in the current exact machine/target/process/conversation scope. A Seen bubble loses its spinner but remains until a user article with the receipt’s exact seen_message ID is rendered. Remove handoff tracking at replacement, scope changes, archival or receipt eviction. Do not infer identity by text or revive initial old Seen receipts. Include the selected conversation in the local intent so this works even when confirmation beats the enqueue HTTP response. This is client-only presentation; delivery and receipts are unchanged.

## Validation and deployment

TypeScript/Vite staging builds pass (existing chunk-size/import warnings). Four distinct focused browser cases pass: phone pending/dedup/native confirmation, old Seen receipts outside loaded history, delayed native history after independent Seen polling, and Seen before enqueue response returns. Latest three-case run passes in 38.5s; prior phone/delayed/old run passed in 35.2s. Delayed-history MutationObserver verifies minimum and maximum visible copies are both exactly one through handoff. Spinner stops at Seen, exact native replacement carries confirmation, and old settled receipts remain absent.

git diff --check passes. Frontend assets published with previous hashes retained and index replaced atomically. Live HTML matches final staging build and bundle is reachable. No backend/agent restart, live messages, receipt mutations or configuration changes. No Rust changes/tests needed. Reload already-open clients to use the updated frontend.
