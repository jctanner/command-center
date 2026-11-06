# Task 0017: Transient host connection feedback

Owner: CC dev
Claimed: 2026-11-06
State: done

Keep selected tmux host connection failures scoped to tmux, clear transient errors on recovery, and prevent background inventory failures from leaving global timeout banners or stale header errors in other workspaces. Preserve explicit action/uncertain-input warnings and automatic read-only reconnects. Validate with isolated offline/recovery and delayed-error browser regressions; no live host disruption.

## Findings and change

Background inventory failures wrote generic timeout text into the global notice and Host unavailable into the shared header. Successful inventory reads did not clear that state unless a terminal attached. Connection rendering now projects the selected host's status only into tmux; other workspaces show CC connectivity and still expose an actual startup Backend unavailable error. Offline discovery uses Machine unavailable / retrying and inline retry feedback rather than a sticky global timeout. Polling/reconnect remains read-only and automatic.

Connection notices are scoped, hidden outside tmux and cleared by authoritative inventory/attachment recovery. Backend viewer creation/state-read errors explicitly include scope=connection; action errors retain their warning semantics. Reconnect no longer clears an explicit action warning, and background connection errors cannot replace one. Existing host/endpoint/generation rejection remains intact. No input or mutations are retried.

## Validation

- Frontend type/build passed, with the existing bundle size advisory; `git diff --check` clean.
- Rust formatting, 42 library tests, Clippy with warnings denied and release build passed.
- Full navigation/SSH/tmux run: 24 passed; one test-fixture dependency found (bug 0012). Machine-management plus corrected close-guard test then passed together (2 passed). Original failed header expectations in Settings were updated to Connected, reflecting the intentional workspace status scoping.
- Added regressions for temporary inventory failure, recovery through background polling without another click, delayed timeout after workspace switch, stream connection warning recovery and preservation of explicit action warnings. Compact navigation still leaves desktop terminal dimensions/processes alone. All four isolated SSH/ProxyJump checks passed; no live host disconnected or live input sent.
- Deployed with existing loopback/LAN/tailnet/HTTPS-origin flags, after private SQLite backup. Existing physical pane ID/PID set survived restart. Loopback/LAN/HTTPS health and frontend verified. Saved features and Slack/Email/Jira source files predate deployment backup. An overly broad sidecar comparison included normal runtime receipt/read metadata updates; refined verification checks only durable source/feature settings. No credentials or source permissions changed.

## Handoff

Reload clients to load the new rendering behavior and clear existing page-local notices. An offline machine still reports retrying when actively viewed in tmux. Action warnings remain visible intentionally. Task 0009 receipt review remains pending. Changes are uncommitted; no commit/push requested.
