# Task0105: Release ACP local commands

Owner: CC dev; claimed2026-11-17; State: done.

Human requests commit, push and deploy all pending CC changes. Includes task0104 explicit ACP local commands, task0101 native command reconciliation and ledger records for deferred task0102 and prior deployment0103. Preserve private state and pending Goose work. Build release, commit/push main over SSH, deploy with exact existing arguments/environment/listeners, verify all access paths and unchanged tmux pane PIDs. Deployment does not itself authorize restarting existing agent conversations; live brokers keep their capabilities until explicitly upgraded.

Implementation verification is recorded in task0104 (96 Rust,50 ACP Python,12 mode Python,6 contract,36 browser tests; formatting/Clippy/frontend build passed). This release adds no source changes.

## Release result

- Implementation and existing pending CC changes committed as `0ec1840` and pushed to SSH origin/main.
- Release build passed. Deployed2026-11-17T20:23:45Z using the existing guarded release procedure with separate private backup/evidence namespace.
- All four configured access paths healthy (loopback, LAN, tailnet HTTP and public-origin HTTPS); staged frontend index hash and running release executable hash verified.
- Exact backend arguments/environment, configuration hashes and complete local tmux pane/PID inventory unchanged. No agent input, restart, conversion, adapter install or uncertain retry occurred.
- Live OpenAPI exposes `local_command`/`cancel_command`, capability/active-command fields and120s/32768-byte limits; existing ACP/native-command/usage/trust/whiteboard contracts retained.
- Evidence in ignored `.local/reviews/acp-local-command-deployment.json` and `.local/acp-command-{release,deploy}.log`; `git diff --check` passed before commit.

Existing ACP brokers (including coordinator) were not hot-patched or restarted. New brokers get local commands; current conversations need a separately authorized broker replacement/resume. This release does not claim real remote-provider command coverage or complete deferred Goose task0102.
