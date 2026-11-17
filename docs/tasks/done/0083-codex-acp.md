# Task0083: Codex ACP support

Owner: CC dev; claimed 2026-11-16. State: done (implementation and fixtures; not deployed).

Add explicit Codex ACP selection alongside Claude, native default unchanged. Allowlist adapter names/providers, bind provider/executable identity into one-use grants, preserve exact process/permission/receipt guards and old Claude brokers. Use maintained agentclientprotocol/codex-acp adapter; no automatic installs, provider migrations or permission bypasses. Cover provider validation, launch identity, queue/chat labels, browser recovery and native defaults. No deployment or live test-agent launch in this task without approval.

## Implementation

Prepare accepts optional allowlisted provider, default Claude for existing clients. Target helper resolves only claude-agent-acp/codex-acp from PATH or provider-specific managed prefix; directory/provider/executable identity stay in the one-use grant. Broker reads provider from private intent and returns it in live metadata/snapshots. Inventory, queue, ticket context and recovery preserve that provider. Launcher offers explicit Codex ACP, retains the selected native provider across ACP switches, and saves provider with pending launch recovery. No installation, authentication provisioning, arbitrary flags or permission bypass.

Reference: maintained https://github.com/agentclientprotocol/codex-acp README; older Zed adapter points new installs to @agentclientprotocol/codex-acp. Native TUI, resume/restart/model overrides/steering remain outside this slice.

## Validation

- TypeScript/Vite build passed; debug and optimized Rust builds passed.
- 90 Rust library tests passed; all-target Clippy with warnings denied passed.
- 14 Python broker/helper tests passed, including provider allowlist, missing adapter and grant executable mismatch.
- Six served OpenAPI tests passed.
- Final seven ACP Playwright tests passed: both providers at desktop/mobile widths, queue provider identity, messaging, explicit permissions, metadata, reviewed close, per-provider lost-response/reload recovery and native-preparation invalidation. Two additional native-launch regressions passed in the broader run. An initial immediate queue assertion raced asynchronous discovery; changed to bounded eventual observation and all seven final checks passed.

Prior deployed ACP changes were committed/pushed first as0b8c05c, as requested. Codex support remains uncommitted and undeployed. A real corsair adapter install/disposable-agent test was requested separately and has not been approved or performed. Production service/agents unchanged by this task. Do not equate fixture tests with a certified real adapter/version.
