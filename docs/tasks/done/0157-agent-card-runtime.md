# Task0157: Agent runtime on cards

Claimed2026-11-18 by CC-dev. Add bounded process-derived elapsed seconds to queue API for native CLI and ACP broker; concise human duration occupies right quarter of context row with unchanged card dimensions. Unknown stays unknown; stale observations labeled. No extra remote calls or transcript scans. Validate helpers, Rust and responsive cards.

## Completed2026-11-18

Native status exposes monotonic elapsed seconds from the verified foreground CLI process start. ACP transport computes elapsed from the boot/PID/start-verified broker without changing its implementation, including inventory and snapshots. Rust queue passes optional runtime_seconds; retained disconnected cards keep last observed values. No conversation-age guessing, remote wall-clock dependency, additional SSH calls or log scanning. API/OpenAPI documents queue and ACP snapshot fields.

Cards split the existing context row3:1, runtime right-aligned with short minutes/hours/days formatting and an em dash when unknown. Tooltip identifies CLI vs broker and last-observed disconnection. Meter text truncates rather than wrapping; card dimensions preserved.

Validation: cargo fmt --check, cargo test queue::tests (5 passed), cargo clippy --all-targets -- -D warnings and frontend build passed. Python runtime helper tests passed for both implementations (valid elapsed, future/negative/invalid starts and unavailable /proc); existing ACP remote11 and native detection5 tests passed (existing sqlite ResourceWarnings). Two focused Playwright cases1440/393 passed:0m,42m,3h12m,2d4h,unknown, same-row placement and unchanged width/height, no horizontal overflow or terminal traffic. Fixture screenshot inspected; test-results/agent-card-runtime-{1440,393}.png. Logs .local/agent-runtime-*.log. git diff --check passed. No live SSH coverage, deployment, commit or agent restart/input.
