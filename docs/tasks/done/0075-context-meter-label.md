# Task 0075: Context text inside the card meter

Owner: CC dev
Claimed: 2026-11-16
State: done (committed, pushed and deployed with approval)

Combine agent-card context labels and meters into one theme-aware bar. Preserve honest unknown/stale/history labels, session totals and accessible numeric meter semantics. Keep expanded conversation metrics unchanged. Stage frontend and verify desktop/mobile fixtures; no deployment requested.

## Result and validation

Card context text sits inside a full-width tinted track; cumulative session totals remain below it. The fill uses theme colors with a muted background so the text remains legible across filled and empty portions. Warning levels at 70/90 percent use yellow/red. Unknown capacity has no fill or numeric meter role; stale/history qualifiers remain. Native detail-pane meter/disclosure unchanged. Accessible custom meter exposes value and full context text. Removed the old detached bottom strip.

- TypeScript/Vite staged build passed (`TMPDIR=/var/tmp npm --prefix web run build -- --outDir dist-next`); existing bundle warnings only.
- Three focused Playwright tests passed (`TMPDIR=/var/tmp CC_BINARY=../target/release/command-center CC_WEB_DIR=dist-next npm --prefix web run test -- token-metrics.spec.ts -g 'token summaries|unknown, selected'`). Synthetic local/SSH agents only: desktop1440/mobile393 layout, numeric ARIA, unknown/history/stale labels and details persistence. No real provider launches or messages.
- Inspected desktop screenshot `test-results/token-metrics-1440.png`: readable context text within the 36% fill track, no overflow. Mobile screenshot generated as well.
- `git diff --check` passed. No backend changes, deployment, commit or push.

## Approved release

Human requested commit, push and deploy. Implementation `f2da9ed` pushed to main. Frontend-only publication verified at 2026-11-16T19:01:26Z: all four configured access paths healthy and serving the staged index. Backend PID/start/executable, canonical tmux pane/PIDs and configuration hashes unchanged. No restart. Previous assets backed up privately; verification in ignored `.local/reviews/context-meter-publish.json`. Reload clients once.
