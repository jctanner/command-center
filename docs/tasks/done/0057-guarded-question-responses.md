# Task 0057: Guarded native question responses

Owner: CC dev
Claimed: 2026-11-11
State: done

Human explicitly requests answering native questions from Agents. Implement process/conversation/screen/prompt-bound expiring grants and durable one-use answer receipts, distinct from tool approvals and ordinary chat. Support recognized single-choice Claude questions and blank Other text field; unfamiliar/multiple/multi-select layouts stay read-only. Navigate inside one shared-transport helper, inspect every transition, verify exact custom text before one final Enter, and never retry uncertain delivery. Keep a stable prompt claim across selection changes and browser/backend restarts, bound to a verified native waiting transition or unique pending question tool call; requests without that lifecycle evidence remain read-only. API/UI/tests/docs, no live answers/test launches or deployment until explicitly authorized.

Installed Claude 2.1.321 bundled UI inspected read-only: numbered/arrow navigation and Enter selection; single-question/single-select submits immediately, while multi-question/multi-select has separate review/submit behavior. No proprietary source copied, model calls made or live prompt keys sent during inspection.

## Implementation and evidence

Implemented dedicated question grants and metadata-only SQLite receipts/claims in `src/questions.rs`, with versioned POST/receipt GET routes and OpenAPI schemas. Grant preparation requires exact process/conversation/screen plus owned native waiting transition or uniquely matching pending question call. Endpoint edits, expiry, replaced processes and ambiguous requests reject. One owned shared-transport job retains endpoint/slot locks through durable claim, guarded keyboard IO and result persistence, even if HTTP disconnects. Navigation and literal Other paste are read back before exactly one Enter; failures after input retain an uncertain claim without replay. Restart preserves claims and converts submitting receipts to uncertain.

`web/src/agent-question.ts` provides literal choices and single-line Other input, stable polling/focus, IME protection, byte bounds, opaque persisted attempt IDs and read-only receipt recovery. No answer text/tokens are persisted as receipts. Compact clients use HTTP only. Multi-question/multi-select/custom layouts remain terminal-only. Source-native question IDs are private; internal helper fields are removed from public responses. Existing tool approvals and ordinary messaging remain separate.

Validation on 2026-11-11:
- `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`: pass.
- `cargo test --lib --quiet`: 67 pass; `cargo build --release --quiet`: pass.
- `python3 -B tests/test_question_api.py`: 13 pass, disposable tmux/provider and private loopback SSH/ProxyJump; stale target/question, endpoint edits, repeated identical new questions, durable claims, storage failure, uncertain partial IO and HTTP-disconnect handling.
- `python3 -B tests/test_question_responses.py`: 13 pass; `tests/test_agent_questions.py`: 4 pass; `tests/test_openapi.py Contract`: pass.
- Earlier focused history/busy-input checks: 34 and 7 pass respectively.
- Browser question/read-only coverage: 9 pass; existing tool-approval phone/SSH/stale/cross-client regression: 1 pass. Final frontend build/type-check passed and the 9 browser tests passed again after the activity wording correction.
- Synthetic mobile screenshot inspected: controls fit without horizontal overflow; Other draft stays intact. Corrected the activity strip to direct supported questions to the answer controls instead of the terminal.
- Live coordinator inspected read-only: recognized question and verified native waiting request identity; no live keys or answers sent.

## Release handoff

Human approved the brief restart with “proceed”. Deployed using the prepared private restart script: all four configured access paths healthy; configuration/listeners preserved; canonical tmux pane/PID inventory unchanged. Served question POST/receipt GET and existing whiteboard contracts verified. Backups retained privately under `.local/backups/question-responses-*`.

Read-only live browser inspection of the coordinator on desktop and phone confirms Input required with four answer controls, zero tool-approval cards, zero page errors, zero terminal WebSockets and zero browser writes. Its live prompt was not answered. Private screenshots/summary are under ignored `.local/reviews/coordinator-approval/answers-*`. Unsupported layouts remain terminal-only; no real-provider answer was submitted as a test. No commit/push or live Board changes performed. See `docs/reference/native-question-api.md` for API/recovery semantics.
