# Task 0027: OpenAPI and agent ticket CRUD

Owner: CC dev
Claimed: 2026-11-07
State: done

## Goal

Publish an OpenAPI contract for coordinator reads and the Board workflow, with full ticket CRUD and practical agent guidance. Preserve optimistic revisions, endpoint scopes and explicit launch consent.

## Acceptance criteria

- [x] Machine-readable contract available from backend and repository, with bounded read schemas and complete Board operations.
- [x] Revision-checked logical ticket deletion retains numbers/history, rejects unreleased launches and never controls agents.
- [x] Coordinator ticket skill and CLI cover list/get/create/update/move/delete without enabling agent orchestration.
- [x] Validate contract and synthetic ticket lifecycle/conflicts; run Rust formatting, focused tests and Clippy. Never mutate live tickets or launch real agents.

## Findings

Existing Board uses POST /board/tickets for both create and full editable-field replacement, not PUT/PATCH. There is no delete route. New logical deletion will retain original rows and launch records, exclude them from normal reads and reserve UUIDs/numbers.

## Validation

- `uv tool run --from openapi-spec-validator openapi-spec-validator docs/openapi.json`: valid OpenAPI 3.1.1.
- `cargo test --lib`: all 44 tests pass, including revision-checked durable deletion, retained launch history, blocked unreleased launches, existing launch/outbox/endpoint guards and SQLite migration coverage. `cargo fmt --all -- --check` and `cargo clippy --all-targets -- -D warnings` pass. Debug and release builds pass.
- `CC_BINARY=target/release/command-center python3 -B -m unittest discover -s tests -p test_openapi.py -v`: five tests pass. Real isolated HTTP backend, empty host configuration, synthetic ticket full CRUD through API and CLI, duplicate/stale conflicts, Unicode byte limits, unknown fields, contract response validation, persisted deletion, UUID/number retention and Origin requirements. Earlier debug fixture needed an index.html and a rebuild after editing the embedded contract; corrected before release verification.
- `python3 -B -W error::ResourceWarning -m unittest discover -s coordinator/tests -v`: thirteen tests pass. Includes no uncertain-write retry, exact Origin, conflict draft preservation and request bounds, plus existing read identity/token-omission checks.
- Updated production backend using original argv/environment, retaining loopback/LAN/tailnet/HTTPS. Private consistent SQLite backup created before restart, with no in-flight Submitting outbox actions. Served contract exactly matches tracked file; all four access paths return healthy. Read-only comparison against the backup confirms live ticket rows/revisions/content unchanged and no live tombstones. A broad metadata-hash assertion initially included expected attention/approval metadata writes; subsequent checks confirmed only those mutable metadata files updated, while deployment configuration/source flags stayed intact. No live ticket CRUD, launches, messages or approvals tested.
- No frontend/terminal transport changes; no frontend rebuild or remote tmux interaction suite needed. Actual Claude skill invocation remains a manual check.

## Handoff

GET /api/v1/openapi.json discovers the installed contract. Coordinator cc-tickets skill and tools/cc_board.py support human-directed Board CRUD; existing cc_read remains GET-only. Create/update use existing POST with complete editable fields and exact revisions. Launch/check/release are documented separate operations, not exposed through the CRUD helper or authorized by ticket edits. Logical deletion retains private contents/history and is not erasure; old backends unaware of markers can re-expose rows after rollback.

Task 0026 uncommitted scaffold is preserved and extended. No commit/push requested. Task 0009 receipt choice remains untouched. Next task 0028, bug 0016.
