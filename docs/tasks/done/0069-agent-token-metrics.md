# Task 0069: Agent context and token consumption (CC-2/CC-3)

Owner: CC dev
Claimed: 2026-11-14
State: done (2026-11-15; pushed and deployed with human approval)

Read-only provider-reported context usage and cumulative conversation tokens on cards/detail. Codex token_count, Claude usage and pi native usage; unknown when absent, explicit provenance/as-of/completeness. Bounded incremental native-log metadata reads through existing transport and backend numeric-only cache; no transcript copies, repeated whole-file scans, provider configuration/hook changes or token estimates. Keep process/conversation scope and disconnection honesty. API/OpenAPI, Rust/Python/Playwright checks; local commit authorized for this task, no push or disruptive deployment authorized. Report before proceeding to CC-55.

## Clean checkpoint before CC-72

Paused at human request before implementation. Only ledger/index changes made; no runtime, API or frontend source changes, tests, deployment or live Board changes. Discovery: native logs are read by per-request `agent_remote.py` via shared transport; queue `status` and selected `details` both provide extension points. Rust queue records need a metrics field. Proposed design still needs review: bounded incremental numeric-only extraction for Claude/pi aggregates with backend cursor/cache, Codex provider cumulative token_count; explicit completeness/source/as-of and unknown context limits. Avoid repeated full scans and cached/input double counting. Resume CC-2/3 after CC-72; CC-55 remains later.

## Resume

CC-72 deployed; its real-harness tests remain unapproved and must not run. Resume metrics per human instruction, local commits only. Use bounded incremental numeric extraction and backend metadata cache, preserving unknown values and provider-specific cache semantics.

## Implementation and decisions

Added numeric-only native log extraction through the shared transport and a bounded Rust metadata cache. Codex uses cumulative native snapshots; Claude deduplicates/updates native message IDs; pi sums recorded consumption across branches while following only the active branch for last-request context. Preserve missing fields as unknown and avoid cache/reasoning double-counting. Native capacity only; no model-name lookup. Log rewrite/truncate, compaction, partial writes, oversized records and cache capacity fail honestly to unknown. The maintained [reference](../../reference/agent-token-metrics.md) documents exact bounds and semantics.

Cards show compact context/session counters and a subtle meter when capacity is known. Details provide a persistent collapsible breakdown, provenance/as-of, selected-project-history warnings and disconnected Last observed labels. Metrics never drive activity, read acknowledgments or input authorization. OpenAPI documents the nullable metrics object. A browser regression caught the old first-summary selector renaming Token details; it now targets the terminal summary explicitly.

## Validation evidence

- `cargo fmt`; `cargo clippy --all-targets -- -D warnings`: passed.
- `cargo test --lib --quiet`: 87 passed with isolated loopback permission (the initial restricted run could not bind sockets). Focused final metrics tests: 4 passed.
- `python3 -m unittest discover -s tests -p test_token_metrics.py`: 9 passed, including numeric-only extraction, partial/native-ID updates, idle reads, bounded scan progress, rewrite/truncate, malformed/oversized records, pi branch metadata, Codex compaction, and public contract validation.
- Existing native-history/activity/detection Python suites: 34 / 5 / 5 passed.
- OpenAPI HTTP suite: 6 passed against an isolated release backend (requires loopback permission).
- `npm --prefix web run build -- --outDir dist-next`: passed (existing bundle-size advisory remains).
- `npm --prefix web run test -- token-metrics.spec.ts`: 5 passed. Simulated executables only, disposable tmux and local SSH server; Codex/Claude/pi metrics, incremental updates and repeat reads over both transports, card/detail labels, unknown capacities, selected-history/stale counters, desktop 1440px and mobile 393px without terminal sockets. Screenshots inspected, mobile details collapsible and no horizontal overflow.
- Release build passed; no production service was restarted. CC-72 real native trust tests remain unapproved and were not run.

## Handoff

Local commit authorized; no push/deploy. Provider format validation uses native-shaped fixtures, not newly launched real provider agents. Very large sessions warm over several polls or remain unknown at accounting limits; missing native context capacity remains unknown. Report this checkpoint before beginning CC-55. No live Board mutations or coordinator messages performed.

## Approved deployment

Human requested Push and deploy. Pushed implementation84a0875, deployed staged release/assets with existing runtime/environment/listeners, preflight checks for submitting outbox/questions/trust and rendering exports, and private binary/database/assets backup. Four configured access paths and Whiteboard SSE healthy; configuration and original tmux pane/PID snapshots unchanged. Running executable hash and token-metrics OpenAPI fields verified. Read-only Chromium showed metrics on 12 live cards, zero page errors, API writes or terminal sockets. Live native metrics observed for Codex/Claude/pi; larger Claude logs correctly reported incremental warming instead of partial totals. No provider agents launched/restarted or trust prompts answered. Existing unavailable hosts remain unavailable; no SSH trust changes.
