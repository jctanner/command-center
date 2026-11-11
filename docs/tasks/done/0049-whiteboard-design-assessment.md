# Task 0049: CC-46 Whiteboard design assessment

Owner: CC dev
Claimed: 2026-11-10
State: done (assessment only; main build awaits human approval)
Related Board ticket: CC-46 (human-supplied brief; no Board access needed).

Assess/prototype Excalidraw vs roughjs in isolation. Propose storage, revisioned element API, semantic layout/readback/export and guarded remote artifact delivery. Produce a concrete phased plan and wait for human go-ahead before main implementation. No production dependency changes, deployment, Board changes or outward messages.

Acceptance: evidence-based engine recommendation, explicit licensing/bundle/theme/API tradeoffs, conflict/undo policy, export rendering strategy and attachment uncertainty/expiry design; document deferred scope and approval boundary.

## Outcome and evidence

Created [Plan 0002](../../plans/0002-whiteboard-workspace.md) and [proposed ADR-0002](../../decisions/0002-whiteboard-engine-and-state.md). Reviewed workspace routing/themes, SQLite state, text Files helper, shared SSH bus, exact-text durable outbox and coordinator authority. Built both pinned engines outside the app; measured initial assets separately from export resources and exercised desktop/compact mount and exports. Excalidraw is recommended despite size because roughjs is only a renderer. Additional Node/Chromium export runtime, conditional shared undo, element/native ID mapping and safe attachment recovery are explicit design gates.

Detailed results/limitations are in the [assessment note](../../notes/2026-11-10-whiteboard-engine-assessment.md). Final four isolated browser prototype visits had no page errors, missing assets or external requests. Excalidraw exported PNG/SVG with ID-bound arrows; rough exported SVG and clean-toggle output. Actual phone gestures and production renderer/outbox integration remain unimplemented. npm installs used ignore-scripts in a temporary directory; app manifests/locks remain unchanged. git diff --check passes.

No live Board calls, messages, remote copies, production dependency/runtime changes or deployment. This completes design assessment only, not CC-46 or any ticket checklist. Await human go-ahead before implementation; Phase 2 requires its own concrete attachment-contract check-in.
