# Task 0043: Codex kind-only environment context

Owner: CC dev
Claimed: 2026-11-10
State: done

Recognize the observed native Codex environment envelope that omits optional per-item provenance, without filtering human XML or ambiguous/mixed records. Preserve input receipts/lifecycle/native reply cursors and invalidate older visible-history caches.

## Findings and implementation

The reported native response_item user record carries environments.environment_context plus generated msg_UUID, turn UUID and numeric create_time, but omits optional content_item_metadata. The older filter required the per-item provenance array, so the injected environment was rendered as human chat.

Accept only the observed single environment input_text envelope when that array is absent and native identifiers/create time are valid. Explicitly supplied malformed/contradictory provenance, mixed records, other kind-only records, missing IDs and ordinary human XML remain visible. Existing explicit harness-provenance filtering is unchanged. Shared classification continues to protect history, launch titles and outbox user-digest observation.

Bumped visible history prefix to codex-visible-v2 and retain existing history_reset behavior for old prefixes. Native logs, reply/native versions, lifecycle events, offsets/cursors, process association and receipt state are untouched.

## Validation and deployment

- Three new Python cases pass: known envelope versus literal XML/lifecycle/title; malformed/mixed/contradictory metadata; old visible-cache reset with unchanged native reply version/cursor and no injected input digest in receipt evidence.
- 62 existing agent Python tests pass (existing SQLite ResourceWarnings). 46 Rust library tests, formatting, Clippy all targets -D warnings and release build pass. git diff --check passes.
- Backend-only deploy retains exact existing argv/environment/listeners. Four access paths healthy; config hashes and canonical pane/PID snapshot unchanged. No frontend build/deploy required.
- Live read-only API check using the prior cached version confirms history_reset, v2 prefix, affected environment record absent and original process/conversation unchanged. No explicit agent input, native restart, approval, receipt archive/release or Board mutation. Private evidence under ignored .local/reviews.

Next task 0044; next bug 0025.
