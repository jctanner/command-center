# Codex ACP support ready

Human requested committing/pushing existing CC changes, then adding Codex support. Existing ACP integration committed and pushed as0b8c05c. Task0083 adds optional Codex ACP through the maintained codex-acp adapter, with explicit provider selection, provider-bound preparation, broker identity, queue labels and recovery. Native remains default; no live agent migration, install, launch, permission decision or deploy occurred.

Validation: frontend/debug/release builds;90 Rust tests;14 Python tests; six OpenAPI checks; seven final ACP browser tests, plus two native-launch regressions; all-target Clippy passed. Queue assertion corrected to await authoritative asynchronous inventory. Real adapter compatibility is unverified: human approval requested for a pinned isolated install and disposable corsair test, still pending. New implementation is uncommitted and undeployed. Preserve existing live Claude broker and native agents during subsequent testing/deployment.
