# ACP local commands ready

[Task0104](../tasks/done/0104-acp-local-command-execution.md) implements explicit Run command for leading `!` in ACP, sharing the durable FIFO without a model turn. Fixed machine/project targeting, bounded literal output/exit status, cancellation and close cleanup are covered by50 ACP Python,12 mode guard,96 Rust,6 OpenAPI and36 Playwright checks. Formatting, Clippy and frontend/backend builds passed. See task for evidence and limits.

Not deployed or committed. Existing coordinator/live brokers need an explicitly authorized replacement/resume to acquire `local_commands`; backend deployment alone does not hot-patch broker processes. Real provider/SSH checks were not run. Keep deferred [Goose task0102](../tasks/pending/0102-container-managed-goose-acp.md) pending; host execution remains disabled for container/profile intents.
