# Task0097: Release ACP busy-time queue and pending CC fixes

Owner: CC dev; claimed2026-11-17; State: done.

Human requested commit all changes, push and deploy. Commit pending tasks0094–96 together, including image replay/recovered-receipt fixes already deployed and new busy-time queue. Prior validation41 ACP Python,11 mode-helper,92 Rust,6 OpenAPI,28 browser regressions plus2 strengthened final-release queue/backend-restart checks; build/Clippy/format/diff checks passed. Preserve listeners/env/config/local tmux pane PIDs; do not restart/migrate/patch live brokers. Confirm backend/API/frontend and queue capability contract across all configured access paths. New queue capability applies only to newly created brokers; existing ones need separate explicit replacement/resume approval. Record evidence and push completed ledger.

## Release result

Implementation commit f1ce21c pushed to origin/main over SSH. Approved deployment completed2026-11-17 14:23:48 UTC. Native in-flight send/attachment/question/trust and checking handoff/restart preflight guards passed without recovery exceptions. Backups retained under .local/backups/acp-prompt-queue-*.

Verified all four configured access paths, initial Whiteboard SSE, complete served OpenAPI, staged frontend index and running release binary. Queue capability/count/held fields, limit16, cancel_queued action and receipt terminal/queued states are present in the deployed contract. Full runtime arguments/environment, configuration hashes and canonical local tmux pane PIDs unchanged. Private receipt .local/reviews/acp-prompt-queue-deployment.json and log .local/acp-prompt-queue-deploy.log.

No live provider launch/input/approval, broker restart, migration or hot-patch. Older live brokers keep their original capabilities and cannot queue while busy until separately authorized replacement/resume. Native launching remains default. Deployment record is committed/pushed separately; documentation does not require another service restart.
