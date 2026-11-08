# Task 0028: Codex internal history records

Owner: CC dev
Claimed: 2026-11-08
State: done

## Goal

Stop displaying harness-generated interruption/environment records as human chat, preserving literal user XML and receipt identity. Refresh existing cached history and validate the reported live agent without sending input.

## Findings

Live process-linked history contains response_item user records whose internal_chat_message_metadata_passthrough explicitly labels generic.turn_aborted or environments.environment_context, with harness provenance. Real human text uses user.text/user provenance. Structured turn_aborted events already drive native lifecycle status. Filter explicit metadata, never XML-looking text.

## Acceptance criteria

- [x] Metadata-proven internal user records excluded from chat, launch titles and outbox user evidence; malformed/ambiguous records and literal human XML retained.
- [x] Version visible Codex history and reset pre-fix cached pages without changing reply/native receipt versions.
- [x] Regression tests, release validation and deployment preserve live processes/listeners and do not send messages.

## Validation

- Confirmed through process-linked live API history and metadata-only inspection of native records. Harness provenance distinguishes generated interruption/environment context from user.text; no raw reasoning/tool output copied into records.
- New history/outbox regressions failed before the fix. Afterward, 64 Python checks passed: history 33, outbox 7, activity 5, background tasks 7, Claude continuation 12. History test run emitted existing SQLite ResourceWarnings; no failures. Tests preserve literal human XML, ambiguous metadata, user hashes and assistant reply/native receipt versions, while excluding internal evidence and resetting old cached pages.
- `cargo test --lib`: 44 passed. `cargo fmt --all -- --check`, `cargo clippy --all-targets -- -D warnings` and `cargo build --release` pass.
- Focused Playwright regression passes (10.4s): actual filtered backend, literal user XML retained, pre-fix cached older bubble removed on the next idle poll, and synthetic screenshot reviewed. Initial fixture path and timeout were corrected to match its dated log directory and existing 5.8-second idle polling policy. No frontend runtime changes or asset rebuild.
- Restarted production backend with exact existing arguments/environment. Live read confirms injected records removed, the original human report preserved and pre-filter known_version triggers history_reset. Existing pane processes and deployment/source configuration hashes preserved; loopback/LAN/tailnet/HTTPS health all pass. No live messages/approvals/launches, log edits or receipt archival.

## Handoff

Codex chat, title discovery and outbox evidence share the explicit-provenance filter. Ambiguous/older logs lacking metadata remain literal; no text-only XML stripping. Existing structured turn_aborted lifecycle status remains authoritative. Open chats refresh automatically; native logs/reply cursors remain unchanged.

Prior uncommitted coordinator/OpenAPI/Board changes preserved. The interrupted live Board sync performed inventory reads only; its requested comprehensive ticket work remains pending, and no agent prompts were sent. Task 0009 receipt choice untouched. Changes remain uncommitted. Next task 0029, bug 0017.
