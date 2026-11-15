# CC-2/CC-3 checkpoint

Implemented read-only context and cumulative token metrics for Codex, Claude and pi via native history transport. Numeric-only bounded metadata cache; unknown capacity/counters stay unknown, process linkage required on cards, selected project history labeled in details. Compact summaries/meters and collapsible breakdowns preserve conversation space and stale/disconnected honesty. API and [reference](../reference/agent-token-metrics.md) document provider cache semantics and limits.

Validation and implementation details: [task0069](../tasks/done/0069-agent-token-metrics.md). Five browser/API cases cover local/SSH with simulated executables, native-ID updates, compact/desktop layout and stale/history labels. Rust, Python, OpenAPI, frontend build and Clippy passed. No real provider agents launched, no push or deployment. CC-72 native trust tests remain on hold pending human permission. Report the local commit before proceeding with CC-55.
