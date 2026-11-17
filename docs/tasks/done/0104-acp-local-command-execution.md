# Task0104: Explicit ACP local command execution

Owner: CC dev; claimed2026-11-17; State: done (local implementation; not deployed).

Human explicitly requests direct command execution for ACP after !pwd was model text. Implement distinct local_command action and leading-! composer mode, bound to current verified broker/session/fixed directory identity and durable UUID receipt. Shared FIFO with prompts; execute only while provider Ready and no permission/uncertain send, without model prompting. Noninteractive /bin/sh -c in pinned project fd, same broker environment, own process group,120s/32KiB combined output cap. Literal command/output/exit status in chat; cancellation/close terminate owned command, no uncertain replay. Explicit Run command action plus host/cwd hint; Send as chat override. Older brokers refuse/no silent fallback. Container/profile brokers must not execute on host (future Goose remains container-only/deferred). Tests/docs/OpenAPI; no deployment/real-agent execution/restart/commit/push requested.

## Implementation

- Added distinct `local_command` and `cancel_command` typed actions with endpoint/instance/UUID guards. Existing prompt action always remains model chat. Fixed broker cwd is pinned by device/inode and open directory fd; no client shell/cwd/environment/PID override.
- Leading `!` explicitly selects Run command, with machine/folder context and a Send as chat override. Older brokers disable execution without silently sending model text. Container/profile intents disable host commands.
- Shared durable FIFO, claim-before-spawn, literal streaming stdout/stderr, exit/timeout/truncation metadata, exact owned-process-group cancellation, and close cleanup. Provider activity/usage/reply cursors remain model-only. Mode switch rejects active or unresolved commands.
- Runtime120s, combined output32KiB, existing16-pending/12000-byte/24h queue limits. Extra pipe drainage is bounded after termination. Output stays in bounded broker memory and the tmux pane; durable receipts contain no stdout/stderr/environment.
- OpenAPI, ACP and coordinator messaging reference updated. Goose/CC-100 remains pending and container-only.

## Validation

- `TMPDIR=/var/tmp python3 -m unittest discover -s tests -p 'test_acp*.py'`:50 passed. Six new broker execution tests cover pinned cwd/no model RPC, stdout/stderr/exit, UUID idempotency, stale instance, approval/FIFO/cancel-before-dispatch, exact running cancellation/handoff guard, timeout/output bounds, changed directory and disabled host execution.
- `TMPDIR=/var/tmp python3 -m unittest discover -s tests -p 'test_agent_mode.py'`:12 passed, including active/queued/unresolved local-command handoff rejection.
- `TMPDIR=/var/tmp cargo test --lib`:96 passed. New typed API test rejects cwd/shell/env/PID/flags injection. Initial sandbox-restricted attempt could not use filesystem/socket fixtures; authorized isolated execution passed.
- `cargo fmt --check`, Clippy all-targets with `-D warnings`, debug backend build and frontend TypeScript/Vite build passed (existing bundle-size advisory).
- `TMPDIR=/var/tmp python3 -m unittest discover -s tests -p 'test_openapi.py'`:6 passed against the updated debug backend.
- `TMPDIR=/var/tmp CC_BINARY=../target/debug/command-center CC_WEB_DIR=dist-next npm --prefix web run test -- acp.spec.ts agent-mode.spec.ts`:36 passed. Desktop/mobile Claude and Codex fixtures verify Run command, literal hostile-looking output, exit statuses, explicit Send as chat, no terminal WebSockets; additional cases verify busy FIFO, lost-ack reload/no replay, streamed output, Stop command and Close killing the shell/cancelling pending commands. The initial mobile layout test was moved before intentional command feedback so it still measures the original empty composer budget; that budget remains unchanged.
- `git diff --check` passed. Evidence: ignored `.local/acp-command-{python-all,mode,rust,clippy,openapi,browser-all}.log` and `.local/acp-local-command-{build,web}.log`.

## Handoff

No service deployment, commit/push, real provider/remote-agent execution or live broker replacement. Tests use disposable fake adapters, local backend/tmux sockets and throwaway projects; real SSH/harness end-to-end coverage remains unperformed. Existing live brokers (including coordinator) retain their old capabilities and require an explicitly authorized replacement/resume after deployment; a backend restart alone cannot add this feature to them. Existing uncommitted native Claude command fix and deferred container task were preserved.
