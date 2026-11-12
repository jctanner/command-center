# Coordinator agent close capability

[Task0062](../tasks/done/0062-coordinator-agent-close.md) adds cc-close and aligns coordinator role/launch/message/coordination routing. Explicit close requests or explicitly delegated bounded cleanup authorize reviewed whole-window closure through the existing agent-bound REST preview/POST workflow, without redundant generic consent. Actual unrelated collateral effects need clarification; uncertainty never auto-retries. No SSH/tmux bypasses or ticket/outbox side effects.

Skill validation passes; coordinator tests13 and existing disposable local/mobile/SSH close tests3 pass. No live agents closed or messages sent; no backend change, deploy/restart or commit/push. A running coordinator can read its updated AGENTS and cc-close skill on its next task. Preserve uncommitted task0061 changes.
