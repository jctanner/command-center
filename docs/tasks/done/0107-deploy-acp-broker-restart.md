# Task0107: Deploy direct ACP broker restart

Owner: CC dev; claimed2026-11-17; State: done.

Human requests deployment of task0106. Build release and staged frontend, preserve exact runtime arguments/environment/config and all tmux pane PIDs, verify all four access paths, release/static assets and acp_restart contract. No live agent restart/upgrade, input, commit or push requested. Existing tests and evidence in task0106 apply; this deployment adds no product changes.

## Verified result

Deployed2026-11-17T21:24:38Z from the uncommitted task0106 working tree (base d9917d3). Optimized Rust release build and staged frontend TypeScript/Vite build passed; diff check passed. All four configured access paths healthy; frontend index and release executable hashes verified. Exact backend environment/arguments, configuration and all local tmux pane/PID identities preserved. acp_restart is live in both target/receipt contract schemas; existing contracts/SSE/assets remain healthy.

No coordinator/agent restart, input, package installation, commit or push. Reload the frontend, then use ACP Details or card context menu → Restart & update broker… and explicitly confirm when Ready. Private deployment/backup evidence: `.local/reviews/acp-broker-restart-deployment.json`, `.local/acp-restart-{release,deploy-web,deploy}.log`.
