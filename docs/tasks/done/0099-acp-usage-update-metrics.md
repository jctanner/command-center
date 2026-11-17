# Task0099: ACP usage_update integration

Owner: CC dev; claimed2026-11-17; State: done (deployed in task0100).

Human requested commit/push existing changes first (completed e6d7162), then fix usage_update. Consume validated session-scoped ACP context occupancy/capacity events, preserve unknown totals, propagate numeric metadata through snapshots/SSE/inventory into process-bound AgentTokenMetrics and existing card/detail meter. Do not sum context snapshots as session usage, infer model capacity or rescan logs. Handle zero/lower-after-compaction, invalid numbers, stale/other sessions and older brokers honestly. Tests/docs/OpenAPI; no deploy/restart/commit/push of new implementation without request.

## Implementation

- Honored ordering: prior CC changes committed/pushed first as e6d7162 (coordinator upgrade records), then began new source work.
- Broker consumes only session-scoped usage_update frames, validating nonnegative safe integer occupancy and positive capacity. Zero occupancy and lower values after compaction replace prior snapshots; invalid fields remain unknown, malformed all-invalid updates are ignored. Bounded recognized Claude model metadata and broker receipt timestamp only; raw cost/arbitrary metadata excluded. No logs, guesses, counters or state transitions derived from token observations.
- Numeric usage rides existing snapshots/SSE/host inventory. Rust maps it to process-linked AgentTokenMetrics bound to broker/instance/session with original observation time and stale flags for disconnected/failed sources. Cumulative session counts remain null/complete false. No added per-agent SSH requests or log scans. Settings accumulation continues excluding unknown totals.
- ACP card and compact chat use existing meter/details. Selected usage-only events update the card meter in place rather than rebuilding the queue. Reopening/reconnecting clears temporary stale UI labels without refreshing event timestamps. Older brokers with no usage retain unreported state. Native metrics behavior retained.
- OpenAPI/reference/AGENTS updated. Published pinned Claude adapter v1 source was read from the previously SHA-512-verified local tarball: used/size mean context occupancy/capacity, with a recognized optional _claude/model tag. No new package installation or source copying.

## Validation

-44 ACP Python tests passed, including usage/zero/compaction, invalid values, unrelated session ignored, excluded cost/arbitrary metadata and unchanged activity; prior queue/receipt/image/permission guards retained.
-94 Rust tests passed (two new metrics normalization/scope/stale tests), cargo fmt --check and Clippy all-targets -D warnings passed.
- TypeScript/Vite build to dist-next and release build passed; existing Vite chunk-size advisory retained. git diff --check passed.
-32 ACP/mode Playwright tests passed against isolated debug backend. Four new usage cases cover fake Claude/Codex at1440/393px: initial unknown,142k/400k36%, compaction12k3%, same metrics in queue/API/SSE/chat/card, process/conversation binding, totals null and no horizontal overflow. Mobile return/reopen verifies fresh labels with unchanged original timestamp. First new mobile navigation check caught ACP's CSS-prefixed back accessible name; explicit label now matches native and final full suite passes.
- Six served OpenAPI tests passed. Visually inspected synthetic393px usage screenshot; header, context row and composer remain aligned. Logs .local/acp-usage-{python,rust,clippy,build,web,release,browser-final,contract}.log; screenshots test-results/acp-usage-*.png.

## Handoff / limits

New integration is uncommitted/undeployed. No live-provider messages, /usage prompts, hooks, real brokers/agents restarts, installs or backend deploy. Native launch remains default. Existing ACP brokers need separately approved replacement/resume to load new reader code, and an adapter usage event must occur before numbers appear; no backfill from unrelated native/project history. Real Claude/Codex/SSH event flow unverified beyond primary source and protocol fixtures. Old brokers may continue showing Usage unreported until upgraded; context occupancy never substitutes for cumulative usage.

## Subsequent approved release

Human requested commit/push/deploy and coordinator upgrade. Implementation d0dd999 is pushed/deployed; task0100 records all four access paths/configuration/runtime/PID verification and successful exact-conversation coordinator upgrade. New broker reader verified, queue capability retained. No usage event yet at verification; normal adapter reports will populate the meter. Earlier staged-status text above describes the implementation checkpoint, not current deployment state.
