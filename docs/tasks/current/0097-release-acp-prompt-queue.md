# Task0097: Release ACP busy-time queue and pending CC fixes

Owner: CC dev; claimed2026-11-17; State: current.

Human requested commit all changes, push and deploy. Commit pending tasks0094–96 together, including image replay/recovered-receipt fixes already deployed and new busy-time queue. Prior validation41 ACP Python,11 mode-helper,92 Rust,6 OpenAPI,28 browser regressions plus2 strengthened final-release queue/backend-restart checks; build/Clippy/format/diff checks passed. Preserve listeners/env/config/local tmux pane PIDs; do not restart/migrate/patch live brokers. Confirm backend/API/frontend and queue capability contract across all configured access paths. New queue capability applies only to newly created brokers; existing ones need separate explicit replacement/resume approval. Record evidence and push completed ledger.
