# Task0084: Guarded native/ACP mode switch

Owner: CC dev; claimed 2026-11-16; State: implementation verified; disposable real-provider test approval pending.

Human approved Codex-first bidirectional switching from agent card context menu. Same tmux pane/directory and exact native conversation: native uses codex resume UUID; ACP uses negotiated session/load UUID. Verify persisted native transcript, exact process/start/endpoint, idle state and unresolved receipts; one-use durable receipt before mutation, read-only recovery, no automatic retry/fallback/new conversation. Preserve shared card metadata after verified replacement. Existing agents are not test targets. Fixture validation first; no real-provider test launches or disruptive deploy without explicit approval. Claude/pi unsupported initially with honest UI explanation.

## Implementation

Dedicated connection-mode prepare/start/status routes use the existing shared SSH/ProxyJump bus. The backend stores expiring one-use metadata-only receipts in private Board SQLite, consumes before transport IO, serializes endpoint writes, and rejects unresolved pane messages/answers or previous handoffs. Fixed helper sources travel over bounded stdin; clients supply no executable, flags, provider source or log path.

Native→ACP verifies one process-linked Codex UUID/transcript/inode/directory and Ready, probes only ACP initialization/load capability before review, then respawns the same pane into a private Codex broker that negotiates session/load (never session/new). ACP→native checks private socket/PID/start/boot/tty and persisted native thread, freezes dispatch under the broker lock with a durable receipt, stops its child group and exact broker via pidfd, then executes validated codex resume UUID. Provider homes/venv are retained; bypass flags are not copied. Existing brokers lacking handoff capability reject before mutation. Source/destination guards, including the native screen hash, are rechecked immediately before replacement. Pending receipts are scoped to the stable endpoint so a changed host cannot inherit an unrelated operation.

Status is read-only with stable endpoint validation and exact replacement/marker/conversation evidence. Shared card preferences transfer only after verification; ticket launch receipts remain historical. Drafts/outbox entries stay on their old process. Remote no-overwrite claims are private and capped at4096. A durable not_sent result is permitted only before any destructive operation, and requires a fresh human review. Uncertain operations never replay. Review starts focused on Cancel and supports browser reload recovery via opaque receipt IDs. Claude/pi switches and fresh-conversation summary fallback remain unsupported.

## Findings and evidence

The maintained Codex adapter advertises loadSession and maps ACP sessionId to native thread.id (source inspected under the upstream agentclientprotocol/codex-acp repository; no code copied). Bug0041 records the pre-release reverse-handoff dead-pane PID issue and its fix. An initial served-contract mismatch was a stale build while the schema was still being edited; final artifact checks rerun on frozen source. Existing production brokers/agents have not been altered, and no real-provider test agent was launched. Human permission requested separately for an isolated corsair install and disposable real round trip; no approval received yet.

Targeted checks: six mode-switch browser regressions pass (desktop/mobile round trips retaining pane/dimensions/sibling/card; busy/stale/unsupported rejection; becoming busy after review is not_sent; lost-response reload recovery without a second replacement). Eighteen broker/helper Python tests pass, including exact load UUID, missing capability/no fresh session, one-use handoff and stale/unresolved guards. Ninety-one Rust library tests and all-target Clippy pass. Final release/regression evidence is recorded in the handoff after completion.

No deployment, commit or push authorized/performed for task0084. The last pushed deployment remains d22f7ae. Do not test against any existing agent. Before deployment, obtain approval for a CC backend restart and preserve all listener flags/configuration/native pane PIDs. Existing old ACP brokers remain untouched; their lack of handoff support is intentional and visible.


## Final regression checkpoint

Optimized release plus17 focused Playwright regressions passed: six new mode-switch checks and existing ACP chat/native Codex/Claude/pi restart and phone recovery coverage. Eighteen Python broker/helper tests,91 Rust library tests, six served OpenAPI tests and all-target Clippy with warnings denied passed. The final endpoint-scope tightening passed the Rust guard regression and all six focused release mode-switch scenarios. Frontend TypeScript/Vite build passed. No new real-provider session, deployment, commit or push occurred.

Real round-trip authorization remains pending. Existing old ACP brokers intentionally lack the private handoff capability; they fail closed and are not upgraded automatically. Claude and pi switching has not been implemented in this Codex-first slice. Verify the real Codex adapter before widening support. All live ticket/run history remains unchanged; task records do not mirror Board status.
