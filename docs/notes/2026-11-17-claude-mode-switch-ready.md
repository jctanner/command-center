# Claude mode switching ready

Task0088 extends the reviewed missing-adapter install and native/ACP handoff to Claude. Pin: @agentclientprotocol/claude-agent-acp@0.107.3, Node >=22. Existing native/default behavior and prior uncommitted tasks0085–87 are preserved. Claude configuration and exact persisted conversation/continuation mapping are required; busy or unverified work refuses handoff.

Validation: 92 Rust, 29 ACP Python, 35 native-history Python, 7 mode-helper Python, 6 OpenAPI and 26 Playwright tests passed; formatting, frontend build, Clippy and diff checks passed. See task0088 for commands, evidence and limitations. No live-provider test, installation, commit, push or deploy this task. Last deployed release remains f3d774b.
