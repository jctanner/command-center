# Codex ACP support ready

Human requested committing/pushing existing CC changes, then adding Codex support. Existing ACP integration committed and pushed as0b8c05c. Task0083 adds optional Codex ACP through the maintained codex-acp adapter, with explicit provider selection, provider-bound preparation, broker identity, queue labels and recovery. Native remains default; no live agent migration, install, launch, permission decision or deploy occurred.

Validation: frontend/debug/release builds;90 Rust tests;14 Python tests; six OpenAPI checks; seven final ACP browser tests, plus two native-launch regressions; all-target Clippy passed. Queue assertion corrected to await authoritative asynchronous inventory. Real adapter compatibility is unverified: human approval requested for a pinned isolated install and disposable corsair test, still pending. New implementation is uncommitted and undeployed. Preserve existing live Claude broker and native agents during subsequent testing/deployment.

## Deployment follow-up

Human subsequently authorized commit, push and deploy. Implementation4d558cf pushed and deployed; all four access paths/SSE/contracts/artifact hashes healthy, exact runtime/listeners/configuration/tmux pane PIDs unchanged. Live desktop/mobile launcher smoke confirms native default and Codex ACP option, zero page errors/API writes/terminal sockets. Reload clients once. Adapter installation and real disposable test were not performed and still need separate approval.
