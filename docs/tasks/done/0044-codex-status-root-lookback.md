# Task 0044: Codex status root look-back

Owner: CC dev
Claimed: 2026-11-10
State: done

Restore verified Codex turn status when recent progress remains in the log tail but the root lifecycle anchor rolls beyond the initial scan. Adapt bounded look-back without inferring state from silence/tool output or allowing child completion to finish a parent. Validate limits, stale/future/incomplete evidence and live association.

## Findings and implementation

The affected Codex process stayed correctly linked to its native log. Its recent 512 KiB contained same-turn item_completed events but no lifecycle anchor; a larger diagnostic window found the root task_started. The parser deliberately refused to infer Working from unanchored progress, producing Unknown.

Split bounded event replay from file lookup. Start at 512 KiB, expand to 2 MiB then 8 MiB only if no root lifecycle anchor is found, and stop at a root anchor or the file start. Reads use one snapshotted file end, remain within each budget, and discard initial partial records inside the window. Preserve same-root progress refresh, 15-minute stale expiry, child event exclusion, invalid/future evidence checks and incomplete-final-write failure. No anchor within the cap remains explicitly Unknown. No full-file scanning, transcript cache, remote metadata writes or new daemon.

## Validation and deployment

- Five new Python tests pass, covering anchor outside both 512 KiB/2 MiB with bounded total reads, fast latest-completion path, child completion/progress and stale parent, future/incomplete evidence, and a root beyond the hard cap. Old small-window replay reproduces missing-anchor result on the synthetic long-turn fixture.
- 62 existing agent Python tests pass (existing SQLite ResourceWarnings). 46 Rust library tests, formatting, Clippy all-targets -D warnings and release build pass. git diff --check passes. No frontend changes/build required.
- Read-only tests on the real linked log restore Working in the 2 MiB window. Three warm remote status scans take 19.85–20.25 ms excluding SSH overhead; all return same native process and root-scoped evidence. Private measurements retained under .local/reviews.
- Backend deployed with exact previous argv/environment/listeners. All four access paths healthy; config hashes and canonical pane/PID snapshot unchanged. Live queue and selected-conversation API both report verified Working from codex_events with original process/conversation identities.
- No agent restart, explicit input, approval, receipt release/archive, native-log change or Board mutation. Native history/reply/read/receipt cursors and terminal transport remain unchanged.

Next task 0045; next bug 0026.
