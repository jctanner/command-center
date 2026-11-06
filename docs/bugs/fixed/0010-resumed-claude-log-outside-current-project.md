# Bug 0010: Resumed Claude log outside current project cannot auto-link

Found: 2026-11-05
State: fixed
Fixed: 2026-11-05

The running reported agent Claude process registry and --resume argument agree on its UUID, but the corresponding log remains in a former repository's Claude project folder. Candidate discovery searches only the current cwd folder, so it omits the known exact log and asks for manual selection among unrelated histories. Resolve that process-proven exact UUID across bounded Claude project folders, preserving path/metadata/continuation validation and rejecting duplicates.

[Task 0015](../../tasks/done/0015-claude-resume-history-location.md)

Resolution: bounded exact process-proven UUID lookup across project folders, validated path/metadata/continuation handling and runtime-registry precedence. Fixture and live API checks now auto-select the correct history; no agent/log mutations.
