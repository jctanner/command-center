# Bug 0016: Codex interruption/context records shown as human chat

State: fixed
Reported: 2026-11-08

## Reproduction

Interrupt a native Codex turn, then view its process-linked conversation in Agents. The harness-generated turn_aborted envelope is shown as a You bubble. Fresh harness environment_context records are also displayed.

## Cause

The Codex history parser accepts every response_item message with role=user, ignoring explicit content-item kinds and harness provenance. Those records can also enter outbox user-confirmation evidence. Existing visible-history caching does not invalidate old pages after filtering changes.

## Expected

Use trusted provider metadata to exclude internal context from human history/evidence, preserve actual user text discussing or containing XML, and keep structured interruption lifecycle evidence. See [Task 0028](../../tasks/done/0028-codex-internal-history-records.md).

## Resolution and evidence

Filter only recognized native content-item kinds with harness provenance and unambiguous aligned metadata. The same parser protects human history and outbox user evidence; title discovery follows it. Version Codex visible history and reset old cached pages while preserving native reply/receipt versions. Proven by failing-then-passing fixture tests, synthetic browser cache-reset regression and read-only verification of the reported live session. Native logs and live agent input remain untouched.
