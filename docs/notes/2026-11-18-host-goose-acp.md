# Host Goose ACP

Task[0129](../tasks/done/0129-host-goose-acp.md) adds host-installed `goose acp` in approve mode, beside retained native/container options. Explicit profile means container; no profile means host. Recovery records distinguish them. Host restart loads the exact saved Goose session and rejects changed state-home environment. No native/container conversion or credential configuration. Coordinator launch guidance and API contract updated.

Build/fmt/Clippy,98 Rust,110 Python/contract and37 browser checks passed. Real Goose1.60.1 on rhlaptop streamed replies before/after exact-session restart using an isolated mock model; all disposable resources cleaned. Real provider authentication/tools not tested; permissions covered by fixtures. Source remains uncommitted and undeployed. Live production still serves task0128; no existing agents changed.
