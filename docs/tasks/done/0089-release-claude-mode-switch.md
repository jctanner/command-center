# Task0089: Release Claude handoff and reviewed adapter installation

Owner: CC dev; claimed 2026-11-17; State: done.

Human requested commit, push and deploy. Release the pending tasks0085–88 together, preserving listener flags/environment, configuration and existing tmux pane processes. Prior validation: 92 Rust, 29 ACP helper, 35 history, 7 mode-helper, 6 OpenAPI and 26 Playwright checks; frontend build, formatting and Clippy passed. Build the final release, inspect preflight active receipts, back up current runtime/database/assets, publish and verify all configured access paths, contracts and process survival. No real-provider tests or agent conversions are authorized by deployment.

## Result

Implementation commit 1a5cf9e pushed to origin/main over SSH. Final release build and frontend TypeScript/Vite build passed. Approved deployment completed 2026-11-17 11:57:56 UTC with backups and no in-flight-operation preflight failures. All four configured access paths, initial Whiteboard SSE, exact served OpenAPI, frontend index and running release binary were verified. Claude/Codex pinned-install and handoff contracts are live. Existing configuration hashes, full runtime arguments/environment and canonical tmux pane PID inventory were unchanged. No agents were launched, converted, restarted or sent input; no adapter was installed.

Private receipts: .local/reviews/claude-mode-switch-deployment.json and .local/claude-switch-deploy.log; backups under .local/backups/claude-mode-switch-*. Real-provider conversion testing remains separately unverified/unauthorized. Codex native startup updater detection (bug0042) remains open.
