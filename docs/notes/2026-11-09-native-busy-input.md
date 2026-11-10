# Native busy input

Task [0041](../tasks/done/0041-native-busy-agent-messages.md) removes the Ready-only gate for explicit saved messages and allows definite anchored submissions to pipeline before native Seen. Preserve exact provider/process/conversation/input boundaries, dialogs, legacy/uncertain barriers and no-replay. Pi normal Enter uses native steering; no interrupts or automatic approvals.

69 Python tests, 45 Rust tests, Clippy/builds and the complete 18-case outbox suite pass; focused final/strengthened cases pass. Deployed backend/frontend with original listener configuration. Original affected messages are both Seen with unchanged identity/text; no manual resends. Full pane inventory comparison changed during deployment (cause unproven), but all previously observed agent identities were preserved. See task evidence/limitations. Next task 0042; next bug 0023.
