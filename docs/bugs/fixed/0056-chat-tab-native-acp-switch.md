# Bug0056: ACP→native card selection loses desktop chat tab

Found2026-11-18 after task0142 deployment. cc-coordinator ACP tab appears, selecting a native card moves its header back into body. syncPresentation docks before nativeNodes restoration; final dock compares only element identity and incorrectly returns though parent changed. Isolated native-only/ACP-only tests miss cross-mode selection. Fix ordering and reconcile actual parent ownership, preserve draft/read/process guards.

Fixed2026-11-18 in task0143. Render updates compact presentation without prematurely docking, restores native/ACP ownership first, then docks the chosen header. Dock reconciliation also verifies the actual parent rather than trusting only its cached element pointer. Two same-page cross-provider tests cover Codex→ACP→pi→ACP→Codex, refreshes, mobile↔desktop and separate drafts. Build and26 browser cases passed. No deployment yet.
