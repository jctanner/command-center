# Direct ACP restart/update ready

[Task0106](../tasks/done/0106-acp-restart-upgrades-broker.md) adds **Restart & update broker…** to ACP Details and card menus. One reviewed ACP→ACP handoff resumes the same verified persisted conversation with current backend broker source. No native-mode detour, new thread, automatic upgrade or uncertain replay. Source SHA-256, process/endpoint identity, state and receipt guards protect the mutation; source and exact resumed session are verified before card metadata transfer.

96 Rust,15 mode Python,6 contract and41 browser cases verified (39 full-run passes plus2 successful command-test synchronization reruns). Builds, formatting, Clippy and diff checks passed. No live agents restarted, deployment or commit/push. See the task for detailed evidence and limits. Next release needs the normal explicit deployment request; existing coordinator can then be upgraded through the new human action.
