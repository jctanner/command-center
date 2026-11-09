# Codex launch approval policy

Task [0037](../tasks/done/0037-codex-launch-approval-policy.md) implements and deploys optional automatic-review launches through the guarded API and both frontend dialogs. Coordinator selects approval_policy=approve-for-me under the user’s standing preference; general UI defaults preserve harness behavior. Unsupported target Codex versions fail explicitly before tmux creation.

Four policy tests, four restart regressions, 44 Rust library tests, Clippy, frontend/release builds and six local/SSH/mobile integration checks pass. Four live access paths healthy; original pane processes/config preserved. No live agent launches or messages. Next task: 0038; next bug: 0020.
