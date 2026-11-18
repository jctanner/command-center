# Native Goose

Task[0121](../tasks/done/0121-native-goose-agents.md) implements native tmux Goose, independent of container ACP: fresh/ticket/resume launch, foreground discovery, bounded read-only SQLite history, row-position receipts, guarded stdin/editor dispatch, exact-session restart and ordinary close. Initial container-only restriction retired by the human. API/docs/coordinator skills updated.

Real Goose1.60.1 installed and checksum-verified on rhlaptop. Disposable native sessions and a local mock provider verified chat, initial prompt, receipt matching, active resume detection, restart and close without modifying existing agents or real credentials; test state cleaned.12 Goose unit,16 launch,99 agent/history,97 Rust,6 API and24 browser tests passed, plus build/format/Clippy/skill validation. Details/evidence in task.

Source remains uncommitted; production CC not deployed. Native credentials/provider setup remains the normal Goose host setup. Native lifecycle/usage/tool event support remains unverified/unreported, and permissions use the terminal. Future deployment must preserve listeners/environment/live tmux identities and must not restart existing agents or convert their stores implicitly.

Subsequent human commit/push/deploy request completed in task[0122](../tasks/done/0122-release-native-goose.md), feature ee1983e. All four paths and local/remote tmux identities verified; live rhlaptop native preparation succeeds without Start. No existing agents or credentials changed.
