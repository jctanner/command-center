# Task0143: Chat tab survives ACP/native selection

Claimed2026-11-18 by CC-dev. Human observes desktop tab only on cc-coordinator (ACP). Native/ACP modes separately worked, but render docked native header before restoring nativeNodes, then restoration reparented it back into detail; pointer-only dock early return missed that. Restore ownership after mode changes and test same-page cross-provider selection/polling/resize with drafts. No agent input or release requested.

## Completed2026-11-18 (local date)

Bug[0056](../../bugs/fixed/0056-chat-tab-native-acp-switch.md): source ownership must be settled before desktop docking. render now calls syncPresentation(false), restores/removes the source-specific nodes, then docks. Responsive/navigation sync still docks normally. Same-pointer reconciliation verifies the actual chat-tabbar parent, repairing a header moved elsewhere rather than returning blindly.

Validation: TypeScript/Vite build passed (existing bundle advisory).20 agent-polish tests passed, including two new1440/1280 cross-provider selections with refreshes and compact round trips; separate Codex/pi/ACP drafts retained, one visible header, no terminal traffic or writes. Six real fixture ACP launch/chat/Details cases passed for Claude/Codex/Goose desktop/mobile.26 browser cases total; logs .local/chat-tab-switch-{build,tests,acp}.log. git diff --check passed. No backend changes, Rust checks, live agent input/restart or commit/push/deploy. Production still task0142 until frontend release.
