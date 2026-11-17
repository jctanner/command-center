# Task 0077: Optional ACP broker and corsair Claude validation

Owner: CC dev
Claimed: 2026-11-16
State: done (experimental slice deployed with human approval)

Human authorized building opt-in ACP/broker mode and disposable Claude tests on corsair. Native tmux launching/polling remains default; no migration of existing agents. Broker must run on agent host under tmux independently of CC, with private local socket, bounded events, serialized prompts and explicit one-time permission choices. Backend uses shared transport; browser never executes SSH. Preserve existing launch endpoint/process guards and durable IDs; reject uncertain replays. No service deployment/restart or commit/push requested. Do not touch existing remote agents. Record design, tests, exact installed adapter version and cleanup evidence.

## Design and implementation

[ADR0005](../../decisions/0005-opt-in-acp-broker.md) and [reference](../../reference/acp-broker.md) describe the optional host-owned broker. Native launch routes/defaults are unchanged. Launcher explicitly selects ACP; a separate ACP agents catalog/chat avoids pretending the native discovery/outbox/ticket semantics apply. Initial provider is Claude ACP v1, new conversations only. Rust REST and SSE use existing shared local/SSH/ProxyJump transport; no additional network port. A remote tmux-owned Python broker supplies a basic line terminal UI and owns the adapter process group; CC is only a reconnectable socket client. Explicit remote source installation occurs only at prepared launch.

Endpoint revision, canonical directory/adapter identity, one-use120-second grants, durable exclusive launch intent, private owner-only Unix socket with peer UID, PID/start/boot/command-line checks, serialized prompts, exact permission revisions/options and durable UUID/digest/action receipts precede ACP IO. Duplicate/uncertain input never replays. Streams are bounded/coalesced, disconnected clients do not own broker lifetime, and terminal output strips control sequences. No model/resume/venv/pre-trust/bypass flags, arbitrary executable paths, native fallback or auto approval. Unsupported client capabilities fail closed.

Current history is bounded in memory; receipts are durable SQLite metadata, not a native Seen outbox. Existing native notifications/cards/ticket launch/restart/attachments and full native Claude TUI parity are not part of this experimental slice. Adapter uses its supported local authentication, not copied credentials.

## Actual validation so far

- TypeScript/Vite staged build passed (existing bundle warnings only). Rust89 library tests, all-target Clippy with -D warnings and formatting passed.
- Python9 tests passed: duplicate/conflicting receipts, stale instance, exactly-once explicit permission choice, uncertain IO without replay, hidden thought exclusion, bounded history, socket/watcher disconnect survival, read-only empty inventory, directory/symlink/hardlink/private-file guards, executable replacement and exclusive launch claim.
- Browser9 checks passed against isolated fake harnesses: ACP desktop1440/mobile393 launch/chat/SSE/permission rejection/terminal reconnect, duplicate UUID/stale instance/Origin checks, plus seven native launch regressions (new/resume, directory/endpoint replacement, SSH restart recovery, pinned/manual projects, uncertain phone launch, pi and default policies). No real provider tool approval granted.
- OpenAPI6 checks passed against a freshly rebuilt isolated backend. The first run caught an old embedded contract in the debug binary; rebuilding resolved it. Added typed-command Rust test caught serde flatten/deny interaction and was fixed before real prompts.
- Browser checks caught async project loading clearing an entered path; controls now disable until inventory is ready and no longer clear input on completion. Both viewport checks then passed. Desktop screenshot inspected; UI deliberately labeled experimental.

## Real Claude on corsair (human-authorized)

Pinned adapter @agentclientprotocol/claude-agent-acp0.107.3 installed in a CC-specific isolated prefix, leaving global native Claude unchanged. Used an isolated CC backend/config/database and fresh throwaway project/session only.

Verified: initialize/session-new, API marker prompt with completed receipt, SSE snapshot, stop CC backend, send a second marker prompt through broker's own tmux terminal, restart CC and reconnect to the exact same broker instance and ACP conversation, and reject stale-instance input without delivering it. Existing two remote pane/PID pairs unchanged. Disposable pane, project and managed broker directory removed; earlier failed test's stopped managed directory also removed. The pinned isolated adapter remains available for future opt-in use. Evidence is private metadata only under .local/reviews/acp-corsair/.

The first reconnect test timed out because its driver reused the old runtime endpoint revision; read-only inspection confirmed the terminal reply. Corrected the driver to fetch the new revision after backend restart, then reran successfully. This is expected endpoint guarding, not an input retry. All real prompts requested marker-only answers with no tools. Real tool approvals remain untested; fixture permission guards passed.

Production backend/web assets have not been deployed or restarted, no existing agent was modified, no commit/push requested. Final release artifact verification follows.

## Final artifact checkpoint

Release build passed. Final release binary + staged frontend passed both desktop/mobile ACP end-to-end fixture tests and all six OpenAPI/ticket contract checks. Python9 safety tests passed on final source, formatting/diff checks clean. Prior native launch regression suite9 (including the two ACP viewport cases) and Rust89/Clippy evidence above remain valid. No live deployment, restart, commit or push performed. A future deployment requires explicit approval for the brief backend restart and must retain all existing listeners/origins/configuration/native pane processes.

## Approved deployment

Human said proceed to the offered backend deployment. Executed private deploy-optional-acp-broker.py at 2026-11-17T01:00:30Z: all four access paths healthy, exact runtime/environment/listeners retained, running binary hash and staged index verified, existing Whiteboard SSE and native question/trust/token contracts verified, config hashes and canonical local tmux pane/PID inventory unchanged. Backups include prior live executable/runtime, stopped-service SQLite and frontend. No agent launched/restarted or input/approval sent by deployment. Metadata verification under ignored .local/reviews/acp-deployment.json. No commit/push requested or performed.

Live compact Chromium verification found the protocol handoff was ignored during an in-flight native preparation. Fixed [bug0039](../../bugs/fixed/0039-acp-protocol-handoff.md): invalidate the read-only native preparation generation while preserving busy/uncertain-launch guards. Three ACP Playwright checks pass, including a delayed native-check regression. Frontend-only correction published at 2026-11-17T01:03:40Z; four paths/index hashes healthy, backend and native pane PIDs/config unchanged, no second restart. Repeated live browser verification passes: native default, explicit ACP dialog, launch disabled until prepared, zero page errors/terminal sockets/API writes. Evidence .local/reviews/acp-live-browser.json and acp-handoff-publish.json.
