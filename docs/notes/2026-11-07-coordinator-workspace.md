# Coordinator workspace

Added `coordinator/` with role instructions, three Claude skills (inventory, overlap review, coordination drafts), startup README and a bounded GET-only Python helper over CC's existing Rust API. Preserve machine/process/conversation evidence; omit action tokens/screens; no live launch or messages. MCP integration and isolation are deferred.

Nine synthetic tests pass with ResourceWarning treated as errors; CLI help and diff whitespace checks pass. Live Claude discovery/remote transport not exercised. See [Task 0026](../tasks/done/0026-coordinator-workspace.md). Start Claude from `coordinator/` to try it. Changes uncommitted; Task 0009 remains pending. Next task 0027, bug 0016.
