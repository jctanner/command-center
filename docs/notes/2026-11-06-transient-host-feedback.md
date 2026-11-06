# 2026-11-06: Transient host connection feedback

Completed [Task 0017](../tasks/done/0017-transient-host-connection-feedback.md), fixed [bug 0011](../bugs/fixed/0011-background-host-errors-leak-across-workspaces.md) and [fixture bug 0012](../bugs/fixed/0012-window-close-fixture-assumes-removed-host-id.md). Background host failures no longer overwrite other workspaces' shared status or leave inventory timeout banners. Tmux retains explicit retry feedback; connection notices clear on recovery while action warnings remain. Stream viewer/read failures now carry connection scope. No automatic input replay.

42 Rust tests, formatting/Clippy/release/frontend build passed. Browser run 24 passed plus the repaired fixture pair 2 passed; new regressions cover polling recovery, delayed timeout after navigation, stream recovery and action warnings, alongside all four SSH/ProxyJump tests. Deployed with listener flags retained; physical pane IDs/processes preserved and source/feature settings unchanged. Loopback/LAN/HTTPS health/assets verified. Runtime receipt/read metadata continues normal updates. Reload existing clients.

Next task 0018, bug 0013. Task 0009 legacy receipt choice remains pending. No commit/push requested.
