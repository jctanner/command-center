# Task 0069: Agent context and token consumption (CC-2/CC-3)

Owner: CC dev
Claimed: 2026-11-14
State: pending (human reprioritized CC-72)

Read-only provider-reported context usage and cumulative conversation tokens on cards/detail. Codex token_count, Claude usage and pi native usage; unknown when absent, explicit provenance/as-of/completeness. Bounded incremental native-log metadata reads through existing transport and backend numeric-only cache; no transcript copies, repeated whole-file scans, provider configuration/hook changes or token estimates. Keep process/conversation scope and disconnection honesty. API/OpenAPI, Rust/Python/Playwright checks; local commit authorized for this task, no push or disruptive deployment authorized. Report before proceeding to CC-55.

## Clean checkpoint before CC-72

Paused at human request before implementation. Only ledger/index changes made; no runtime, API or frontend source changes, tests, deployment or live Board changes. Discovery: native logs are read by per-request `agent_remote.py` via shared transport; queue `status` and selected `details` both provide extension points. Rust queue records need a metrics field. Proposed design still needs review: bounded incremental numeric-only extraction for Claude/pi aggregates with backend cursor/cache, Codex provider cumulative token_count; explicit completeness/source/as-of and unknown context limits. Avoid repeated full scans and cached/input double counting. Resume CC-2/3 after CC-72; CC-55 remains later.
