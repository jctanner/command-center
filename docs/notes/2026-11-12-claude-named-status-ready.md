# Claude named tmux status fix ready

[Task0061](../tasks/done/0061-claude-named-session-status.md) fixes [bug0030](../bugs/fixed/0030-claude-named-session-status.md): native named-session records are resolved to complete observed tmux identities on the same socket, retaining process/domain/cwd/session guards. Four new matcher/process/real-tmux tests plus history34, response13, question4 and busy-input7 pass; format/Clippy/release build pass. Source-only read of the unchanged live target verifies Ready from native completion evidence.

Backend deployment is pending human restart approval; prepared private script is not executed. Two original queued intents remain untouched. After approved deployment, normal worker delivery may resume from verified provider evidence; no force-submit, retry, receipt archive, agent restart or commit/push was performed.

Deployment subsequently approved/completed; see [deployment note](2026-11-12-claude-named-status-deployed.md).
