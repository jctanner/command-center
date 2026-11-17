# Task 0082: Integrated ACP agent cards and chat

Owner: CC dev
Claimed: 2026-11-16
State: done (deployed with human approval)

Human approved integrating ACP into regular cards/chat and removing the visible prepare step. Native launching/polling stays default. Add bounded backend broker inventory, honest protocol activity/attention, shared card metadata and ticket context; use ACP-only streams/receipts/explicit permission controls in the ordinary detail panel, never native keystroke fallback. Launch prepares internally; preserve durable launch recovery. Explicit close supported; restart/resume remain unavailable until verified. Existing brokers remain compatible; no implicit migration or restart. Tests use disposable fake adapters; no new real-provider launches or service deployment/restart without explicit scope. Preserve existing uncommitted task0077–81 work.

## Delivered

ACP brokers appear in the ordinary agent list with shared name, notes, color, pin, ticket capture, attention/read metadata and notification behavior. The selected conversation uses bounded ACP SSE history, sanitized Markdown, exact permission choices, per-process drafts and durable uncertainty holds. Native log polling/input and global outboxes remain separate. Only the active conversation UI is attached, preserving native selectors and focus. Compact navigation never attaches a terminal.

The standard launcher defaults to native; explicit ACP selection exposes one Start action that prepares internally. Persist recovery identity before launch IO; Check launch reads the original broker, including after reload or runtime connection-revision changes, after checking the stable endpoint. Initial prompts are submitted once and removed from launch intent plaintext. Close requires an explicit target review, exact broker/start/tty checks and a durable receipt before pidfd signaling; retained receipts remain readable after exit. No restart/resume or busy-time ACP queue is implied.

Inventory verifies authoritative tmux membership and broker process identity, with bounded compact observations; native discovery skips the same panes. Completed-reply attention uses stable receipt positions rather than token-event sequence. Existing brokers remain compatible without restart. API and operational reference updated, including card targeting and receipt reads. Bug0040 records the project-loading race found during verification.

## Validation

- `npm --prefix web run build -- --outDir dist-next`: TypeScript and Vite pass.
- `TMPDIR=/var/tmp cargo test --lib`: 90 passed.
- Python broker/helper unit tests: 13 passed; initial-prompt redaction/exactly-once, stale target and receipt uncertainty, close deduplication, bounded reply positions covered.
- OpenAPI contract checks against isolated backend: 6 passed.
- `TMPDIR=/var/tmp cargo clippy --all-targets -- -D warnings`: passed.
- Focused Playwright ACP/native-launch/card/outbox regressions: 12 passed. Desktop/mobile chat, permissions, metadata, native fallback exclusion, close review, lost-response recovery and native defaults covered. Browser screenshots saved locally.
- Existing real remote Claude broker read-only compatibility: one card and readable chat, no launches, messages, approvals or process changes. No new real-provider test agents launched.

## Limits and handoff

No deploy, service restart, commit or push performed for this integration. Optimized release build, four ACP browser tests and six OpenAPI checks also passed; see the dated handoff. Native remains default. ACP requires Linux proc/pidfd guards; recent history is bounded and does not claim native transcript persistence. ACP restart/resume, arbitrary attachment sending and busy-time queuing remain unsupported. Deployment needs human approval for the backend restart; do not restart existing broker sessions.

## Approved deployment

Human requested deployment after implementation report. The verified release was deployed with one brief backend restart, preserving exact runtime environment/listener arguments. Four access paths, initial Whiteboard SSE, existing native contracts, integrated ACP card/receipt/close contracts, frontend index and running binary hash verified. Configuration and canonical tmux pane/PID inventory unchanged. The deploy script's final close-schema assertion initially assumed a flat schema; corrected to inspect oneOf and completed read-only verification without another restart. No agent launched, approved, messaged or restarted. No commit or push.

Live browser smoke: desktop and mobile both opened existing ACP chat; 12 cards, zero browser errors, terminal sockets or API writes. Reload existing clients once.
