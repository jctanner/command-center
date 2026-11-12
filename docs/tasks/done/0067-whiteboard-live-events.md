# Task 0067: Whiteboard live events and catalog reconciliation

Owner: CC dev
Claimed: 2026-11-12
State: done

Replace routine scene polling with bounded SSE metadata invalidations after committed Whiteboard writes. Refresh catalog and selected scene; reconnect full reconciliation, preserve selection/drafts/in-flight receipts/conflict guards, show queued/paused/reconnecting states. Hidden clients disconnect and reconcile on return; bounded slow fallback while SSE unavailable. Handle remote create/rename/delete including selected deletion without discarding a local draft. REST remains authoritative, no CRDT/history copy or terminal activity. Rust/HTTP/Playwright and OpenAPI/docs updates, request approval before disruptive deployment; no live board edits, commit/push without request.

## Implementation and validation

Implemented, tested and deployed after human approval on 2026-11-12. No live drawing changes, agent messages, commit or push.

- `whiteboard_events.rs` streams bounded/coalesced metadata invalidations through a watch channel, initial invalidation on every connection, backend epoch and sequence, 32-connection limit, keepalive, no-store and proxy-buffering opt-out. Publication occurs inside the owned database job after successful commits; read-only/idempotent replay and rollback do not publish.
- Browser EventSource reconciles catalog plus selected scene, including remote create/rename/delete, visibility and online/offline transitions. Healthy streams avoid routine GET polling; failed streams use native reconnect plus 15-second fallback. Local gestures, conflicts and uncertain receipts retain their guards/drafts. Selected remote deletion preserves a draft or chooses another board when clean. Status explains deferred/reconnecting states.
- OpenAPI route inventory, stream documentation and Whiteboard API reference updated. No extra package dependency or durable history duplication.
- `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, release build and `npm --prefix web run build -- --outDir dist-next`: passed.
- `cargo test --lib whiteboard --quiet`: 22 passed; `cargo test --lib whiteboard_events --quiet`: 2 passed (publication, rollback/read suppression, coalescing and connection limit).
- `python3 -m unittest discover -s tests -p test_whiteboard_api.py`: 6 passed, including actual HTTP SSE headers/initial notification/committed create, graph, metadata, delete, reconnect and idempotent/conflict suppression.
- `python3 -m unittest tests.test_openapi.Contract`: 1 passed.
- `npx playwright test tests/whiteboard-shared.spec.ts tests/whiteboard-delete.spec.ts` from `web`: 14 passed. Includes two-client desktop/phone editing, conflict retention, hidden-workspace pause/return, lost-save and delete recovery, live catalog, idle GET count, active-edit deferral, network reconnect and selected deletion with unsaved draft. Synthetic phone screenshot inspected: status fits above canvas. No terminal sockets in shared-client tests.
- `git diff --check`: passed. Private test logs `/tmp/cc-whiteboard-events-*`; screenshots under ignored test-results.

## Deployment and handoff

Human approved with “proceed” on 2026-11-12. Executed `/tmp/cc-deploy-whiteboard-live-events.py`: backed up runtime/database/assets, preserved exact runtime argv/environment/listeners, preflighted pending deliveries/questions/exports and restarted backend with staged frontend. Health and initial SSE invalidation verified across all four configured access paths. Configuration hashes and canonical tmux pane/process snapshots unchanged. Whiteboard HTML remains no-store; existing image/export/question/attachment contract preserved.

Read-only live Chromium verification: “Live updates”, zero page errors, zero Whiteboard mutations, zero terminal sockets. No live boards edited, agent inputs sent, commit or push. Existing browser pages need one reload to load the new frontend; subsequent remote changes reconcile automatically. Real iPhone/network-proxy outage behavior beyond the tested fixtures remains unverified.
