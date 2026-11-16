# Task 0076: Token usage in Settings

Owner: CC dev
Claimed: 2026-11-16
State: done (committed, pushed and deployed with approval)

Remove cumulative counts from agent cards. Add Settings Token usage grouped by machine, using existing bounded queue metrics. This first view totals currently inventoried process-linked conversations, not lifetime billing/history. Deduplicate provider/conversation within each endpoint; exclude unverified project history and stale/disconnected counters from fresh totals. Show unknown/partial coverage explicitly. Manual refresh only, abort on leaving, no provider IO beyond normal queue read and no persistent transcript copies.

## Implementation

Added Settings → Token usage with machine totals and per-conversation provider/model, total, input/output/cache table. Reads existing GET /api/v1/queue on section entry/manual refresh only, cancels on leave, and clears stale display before a request or failure. Same-machine provider/conversation duplicates select newest observation. Excludes unverified, unavailable, disconnected and stale usage; partial scans labeled. Missing totals show no reported usage rather than an invented zero. Visible cache accounting notes prevent adding included cache twice. HTML uses textContent; phone tables scroll horizontally within the page. Global total is machine-qualified (copies on different machines remain separate).

Removed session totals from cards, retaining context meter and full conversation Token details. Reference docs updated. This is deliberately a current-inventory snapshot; durable accounting of closed conversations is not implemented. No schema or backend changes.

## Validation

- Staged TypeScript/Vite build passed; existing bundle warnings unchanged.
- Five focused token-metrics Playwright checks passed: desktop/mobile context-only cards, detail counts, stale/unknown/history semantics, settings aggregation deduplication, partial/unavailable exclusion, refresh failure, no terminal sockets and no page overflow.
- Five existing settings Playwright checks passed, including shared feature revision conflict, unsaved machine drafts, disabled workspaces and compact navigation.
- Inspected mobile usage screenshot (ignored test-results/settings-token-usage-393.png); table has a contained horizontal scroller, section scrolls normally.
- Initial aggregation test assumed no startup queue read; corrected its refresh assertion to compare against the actual baseline. No production actions.
- No deployment, commit or push requested/performed. Assets staged in web/dist-next.

## Approved release

Human requested commit, push and deploy. Implementation `e724fb1` pushed to main. Frontend-only publication succeeded at 2026-11-16T21:06:41Z: four configured access paths healthy and serving the staged index. Backend PID/start/executable, canonical tmux pane/PIDs and config hashes unchanged. No service restart. Previous assets retained privately; verification in ignored `.local/reviews/settings-token-usage-publish.json`. Reload once to load Settings Token usage and the simplified cards.
