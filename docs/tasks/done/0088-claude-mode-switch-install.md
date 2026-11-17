# Task0088: Claude mode switching and missing adapter installation

Owner: CC dev; claimed2026-11-17; State: done (fixture-verified; not deployed).

Extend task0087's reviewed pinned installer to Claude and support native/ACP handoffs only with exact native session mapping and supported load/resume semantics. Preserve current Codex support, unpublished tasks0086/87 and native default. No arbitrary package/version/prefix flags, global install, auto update/trust/permission, forced live restart or new-conversation fallback. Existing brokers stay compatible read-only; unsupported handoff refuses before mutation. Verify upstream session mapping; fixture Rust/Python/Playwright/OpenAPI tests. No deploy or real-provider test launch without explicit request.

## Implementation

- Added the fixed Claude adapter profile: @agentclientprotocol/claude-agent-acp@0.107.3 with published SHA-512 integrity, isolated claude prefix, provider-exclusive lock, no lifecycle scripts/overwrite/global install. Node >=22 is checked and its executable identity bound before IO; CC never installs Node.
- Claude native→ACP uses advertised v1 session/load with the exact process-linked persisted UUID; ACP→native uses claude --resume with independently validated persisted continuation mapping. Preserve CLAUDE_CONFIG_DIR, venv and directory. No summary, guessed UUID, fork or new-session fallback.
- Same receipt/endpoint/process/screen guards, separate install/switch confirmations and metadata transfer apply to both providers. Active/unverified native background tasks and pending ACP tools block handoff. Older brokers without handoff capability are rejected without modification.
- Updated the card action, reviewed installer, OpenAPI and maintained docs. Existing Codex first-message/install work remains intact.

## Evidence (2026-11-17)

- Read npm metadata and SHA-512-verified published 0.107.3 tarball without installing/executing it. Published ACP v1 advertises loadSession and resumes the requested sessionId. SDK optional binary dependencies do not require lifecycle scripts. These source checks do not prove real-provider interoperability.
- cargo fmt --check; cargo test --lib: 92 passed; cargo clippy --all-targets -- -D warnings: passed.
- Frontend TypeScript/Vite build to dist-next: passed (existing chunk-size advisory).
- Python test_acp*.py: 29 passed; test_agent_history.py: 35 passed; test_agent_mode.py: 7 passed; served OpenAPI contract test_openapi.py: 6 passed.
- Playwright agent-mode.spec.ts, acp.spec.ts and codex-first-message.spec.ts: 26 passed against an isolated debug backend and dist-next. Includes desktop/mobile Claude exact-session round trips and reviewed fake-npm installs; native PID stays unchanged during install and switching remains a second confirmation.
- Initial Claude fixture incorrectly ended on a user event, correctly yielding Working; corrected to a completed assistant turn. An initial restricted Python socket run was denied by the sandbox; rerun with local socket access passed. Existing Python sqlite ResourceWarnings remain.
- git diff --check passed. Logs: ignored .local/claude-acp-{build,web,python,history,contract,rust,clippy,full-browser}.log.

## Limits / handoff

No real provider test agents, remote installs, live process changes, service restart, deploy, commit or push. Disposable real-Claude/adapter round-trip testing needs explicit authorization. Task0084 retains that separate live-test checkpoint. Native remains default; pi switching remains unsupported. Ready for human review and requested deployment.
