# Task0105: Release ACP local commands

Owner: CC dev; claimed2026-11-17; State: current.

Human requests commit, push and deploy all pending CC changes. Includes task0104 explicit ACP local commands, task0101 native command reconciliation and ledger records for deferred task0102 and prior deployment0103. Preserve private state and pending Goose work. Build release, commit/push main over SSH, deploy with exact existing arguments/environment/listeners, verify all access paths and unchanged tmux pane PIDs. Deployment does not itself authorize restarting existing agent conversations; live brokers keep their capabilities until explicitly upgraded.

Implementation verification is recorded in task0104 (96 Rust,50 ACP Python,12 mode Python,6 contract,36 browser tests; formatting/Clippy/frontend build passed). This release adds no source changes.
