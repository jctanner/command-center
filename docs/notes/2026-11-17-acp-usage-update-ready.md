# ACP usage integration ready

Prior records committed/pushed first as e6d7162. New usage integration remains uncommitted/undeployed. Broker validates session-scoped usage_update occupancy/capacity, retains event receipt timestamp, replaces lower compaction values and leaves cumulative totals unknown. Snapshots/SSE/inventory feed process-linked card/chat meters; usage-only selected-card updates happen in place, stale/reconnect handling preserves timestamp. No native log scan, model-capacity inference, /usage prompt or real-agent change.

44 ACP Python/94 Rust/32 browser/6 OpenAPI checks, Clippy/format/frontend/release/diff passed. Four synthetic usage browser cases cover Claude/Codex desktop/mobile, compaction, unknown totals, exact binding and reopen/stale handling. Existing live brokers require separately approved replacement to consume events; values appear only after adapter reporting. No real-provider/SSH coverage claimed. See task0099 and bug0048.
