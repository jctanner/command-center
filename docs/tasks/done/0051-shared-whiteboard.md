# Task 0051: Shared Whiteboard and coordinator drawing

Owner: CC dev
Claimed: 2026-11-10
State: done (shared core deployed after explicit human approval)
Related: CC-46. Human approved building shared Rust storage/API and coordinator drawing from lightweight prototype, with a vertical left toolbar.

Acceptance: named/ticket-linked boards, durable revisioned semantic elements, idempotent element/batch API and agent layout/readback, live browser polling with preserved drafts and conflicts, guarded local undo, agent instructions/helper and OpenAPI, desktop/mobile regression evidence. Preserve standalone prototype, independent compact terminal isolation and existing workflows. Exports keep SVG/JSON/browser PNG; remote attachments and server PNG are later scope. Prepare/test everything before any service-disrupting deployment approval.

## Implementation

Rust whiteboard module persists named/ticket-linked scenes, semantic elements and retained identities in the existing Board SQLite sidecar. Per-element/dependency revisions support independent merges; atomically validate binding edits/deletes/restores. UUID/digest receipts make drawing operations idempotent without copying full scenes into receipts. Bounded recent drawing snapshots, actor attribution, graph placement without pixels, text readback and native JSON export are implemented. Creation, metadata and logical deletion have identity/revision guards. Global scene/history/receipt/identity caps are explicit.

Whiteboard is a lazy top-level workspace using a same-origin editor page. Only /whiteboard.html changes framing policy to SAMEORIGIN; every other page retains DENY. The custom roughjs editor now has a vertical left toolbar. Named selection/new/rename/ticket link/import-local-sketch controls, visible-only polling, element-wise merge, kept drafts/conflict choices, conditional undo/redo and read-only uncertain-operation recovery are wired to the backend. UUID retention permits checked undo restoration and preserves the original creator. Per-tab recovery namespaces prevent ordinary tabs overwriting each other's pending records. Browser SVG/PNG and local-draft JSON exports remain separate from committed REST JSON export.

Coordinator cc_whiteboard.py provides read/create/draw/apply/patch/recovery commands via REST, with saved intent UUIDs and no automatic write retries. Added cc-whiteboard skill using skill-creator guidance, role instructions, dedicated reference and OpenAPI request/response schemas and route coverage.

## Actual validation

- cargo fmt --check, cargo clippy --all-targets -- -D warnings, cargo build --release pass. All 52 Rust library tests pass, including six new whiteboard tests for independent merges, stale/partial rejection, operation idempotency, bindings/deletion atomicity, durable compact receipts and creator-preserving checked restoration.
- tests/test_whiteboard_api.py: 5 passed on isolated backends/databases; graph layout/readback, request/scene schema validation, metadata/ticket link/delete, patch dependencies/duplicate intent, restart, coordinator helper, Origin and scoped framing headers.
- Existing tests/test_openapi.py: 6 passed, including new exact whiteboard route coverage plus ticket CRUD/conflict/helper regressions.
- Initial full browser run: 15 passed (25.1s), covering nine existing ticket/host-error tests plus six shared/prototype tests. After final whiteboard-only changes, those six passed again (20.2s): two-client edits and API drawing on desktop/phone, conflicts/draft recovery, conditional undo/new-object redo, hidden polling/lazy load, lost response/reload/read-only receipt confirmation without replay, and prototype drawing/exports/touch pinch. Zero terminal WebSockets in shared fixture cases.
- Desktop and phone screenshots visually inspected. Actual iPhone not tested. Native shared transport was not changed; no live SSH test writes/messages.
- Initial shared browser tests exposed DENY blocking the component frame; scoped SAMEORIGIN fixed it. Clippy cleanup applied. Deleted identity handling was extended to checked restoration to support undo/redo safely; regression tests pass.
- Skill quick_validate passes. git diff --check passes. Builds retain existing bundle warnings. Prototype's initial rough import/type and text blur fixes are recorded in task 0050; some npm invocations from repository root failed before rerunning in web.

## Deployment boundary and handoff

Only the standalone preview's left-toolbar/assets update was published; live main index hash is unchanged. Shared backend, navigation and API are staged but not live. No backend restart, live Board writes, agent messages/launches or file transfers. A prepared private deployment script is /tmp/cc-deploy-shared-whiteboard.py; it preserves argv/env/listeners, backs up SQLite after stopping the old backend, retains old assets and checks health/config/pane PID preservation. It has NOT been executed. The human's CC-46 brief requests approval before service-disrupting deployment; ask for the brief CC reconnect before running it. Native agents should remain running.

Still deferred: remote attachments/expiry/checksum delivery, server PNG/SVG rendering, selection/frame export, images/Excalidraw import and advanced editing. The shared core is not completion of the entire CC-46 checklist. Next task 0052, next bug 0028; keep this task current until shared deployment outcome is recorded.

## Approved deployment

The human replied proceed on 2026-11-10, authorizing the prepared deployment. Executed the private deployment script once. SQLite backup taken after old backend stopped; runtime argv/environment/listeners preserved, staged main/shared assets published with previous hashes retained. All four access paths healthy; configuration hashes and canonical tmux pane/PID snapshots unchanged. Served OpenAPI exposes the graph endpoint.

Read-only live Chromium check opens #/whiteboard, shows the shared board selector and ten vertical toolbar tools, with no page errors, HTTP writes or terminal WebSockets. Private screenshot/result under .local/reviews/shared-whiteboard-live.*. No live boards/tickets created, no agent messages/launches/restarts or remote copies. Native agents remain alive. Reload CC to load the new navigation; create a named board, or explicitly import the browser-local sketch.

This completes the approved shared core, not the later remote attachment/server image rendering phases of CC-46. Next task 0052; next bug 0028.
