# Bug 0013: README underspecifies setup requirements and old navigation

Found during Task 0018 public-release review at pre-cleanup snapshot. README:17 permits any edition-2024 Rust toolchain, but locked uuid 1.29.0 requires Rust 1.89; locked Vite 7.3.7 requires Node ^20.19.0 or >=22.12.0. README:31 still points to Machines rather than Settings > Machines. Linux-specific /proc agent requirements also need a supported-platform statement. Declare/test supported minimums and correct setup/navigation instructions. No fix applied: user requested review only. Current-toolchain isolated builds/startup pass; minimum toolchains untested.

## Resolution

Fixed 2026-11-06 in Task 0021. README now recommends current stable Rust, states the locked dependency floor of Rust 1.89, requires Node 22.12+, lists verified compiler/runtime versions and explicitly leaves minimum toolchains untested. Linux /proc requirements and platform limitations are clear; navigation is Settings > Machines. This fixes the misleading prerequisite claim without claiming an untested minimum build. Local links/anchors, installed tool versions and locked Vite engine metadata checked; no runtime code changed.
