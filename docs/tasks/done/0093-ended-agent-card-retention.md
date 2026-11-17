# Task0093: Remove ended agent cards after complete scans

Owner: CC dev; claimed2026-11-17; State: done.

Human closed switchme2 but its card remains. Read-only live queue confirms disconnected ACP card, reachable host, old last_seen and no longer foreground. Five-minute retention currently applies even to complete successful scans. Restrict grace retention to unavailable/incomplete scans; complete authoritative scans should remove absent agents even when remain-on-exit keeps the pane. Treat ACP discovery failure as incomplete. No user agent input or mutation.

## Implementation and validation

Complete successful scans now use observed agent targets to exclude confirmed-absent agents from grace retention, even when their dead pane still exists. Incomplete/unavailable scans preserve the existing five-minute retention and original last_seen; ACP discovery failures are explicitly incomplete.

cargo fmt, five queue Rust unit tests, Clippy all-targets -D warnings and git diff --check passed. Isolated debug backend build passed. Seven ACP Playwright tests passed; added explicit remain-on-exit setup before Close and assertion that the pane remains dead while the card disappears, for both providers at desktop/mobile widths. Native process/replacement and host-unavailable retention guards remain covered by queue unit tests. Logs .local/ended-agent-{tests,clippy,build,browser,release}.log. No user-agent inputs, restarts, close actions, configuration changes or deployment occurred. Source and release build are ready; release build passed. Await explicit approval for the required backend restart before deployment. Prior uncommitted mobile fixes are preserved.

## Approved release

Human requested deploy, commit and push. Backend deployment completed2026-11-17 13:03:30 UTC. Preflight pending-operation guards passed; backups retained. Four configured access paths, initial SSE, complete served OpenAPI, frontend index and running release binary verified. Exact runtime arguments/environment, configuration and canonical tmux pane PIDs unchanged. Receipt .local/reviews/ended-agent-cleanup-deployment.json; log .local/ended-agent-deploy.log. No live-agent input, close, restart or conversion. Recent frontend-only mobile fixes0090–92 are included in this release record and commit scope.
