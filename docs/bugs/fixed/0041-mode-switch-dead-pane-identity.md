# Bug0041: Empty tmux pane PID after broker exit

State: fixed in pre-release task0084 tests, 2026-11-16.

The reverse fixture handoff stopped its exact broker safely, but tmux clears pane_pid for a remain-on-exit dead pane. Parsing it as an integer aborted before native resume. Accept an empty PID only for a confirmed dead pane with the same guarded marker; reject any different live pane PID/start identity. The desktop/mobile bidirectional regression verifies the same pane resumes, preserves sibling PID and dimensions, and duplicate operation UUIDs never respawn again. No production agent was affected. Errors also now use the existing normalized helper response envelope so failure reasons reach the receipt.
