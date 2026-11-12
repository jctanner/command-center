# Coordinator agent restarts

The coordinator may restart agents when explicitly requested or delegated a maintenance task that explicitly includes restarts of named agents/a bounded set. Clear scope supplies authorization without repeated generic confirmation or requiring a web dialog click. This is distinct from messaging, launch and close permissions; a package installation request alone does not imply permission to interrupt running agents. Installing this skill selects no live agents for restart. Do not restart the coordinator/current operator unless explicitly included.

Use `coordinator/.claude/skills/cc-restart/SKILL.md`. Existing backend GET/POST restart routes support Codex, Claude and pi; this adds instructions/fixture tests, not a package installer or new backend endpoint. A rebooted/dead agent has no current process to restart: use the separate explicitly requested native resume launch with a verified saved session.

## Post-update sequence

1. Identify requested machine IDs, stable tmux session/window/pane IDs, foreground instances and process-linked conversations from fresh hosts/queue/conversation reads. Review active work and whether the maintenance task permits interrupting it. Clarify only concrete scope ambiguity/collateral effects. Ordinary background status or terminal silence does not decide whether work is disposable.
2. Finish and verify the authorized installation through its separately authorized workflow. If explicitly assigned maintenance includes it, the coordinator may use cc-message to ask the relevant machine agent to perform the update and report its result. No arbitrary package-manager/shell/SSH execution is added to CC or the coordinator by this restart skill. Distinguish an agent's reported update from independently observed version evidence; installation failure stops this sequence.
3. Obtain a fresh restart preparation **after** installation settles. The helper resolves the installed CLI via CC transport PATH plus standard user executable directories, binds its device/inode/size/mtime identity, and constructs native resume arguments. It does not execute the old `/proc/PID/exe` image. Multiple installations or custom shell PATHs may differ from that lookup: review the returned executable path and use real updater/version evidence to establish the desired version. No arbitrary CLI/model/approval overrides in Start. If installation changes after preparation, its guarded comparison refuses respawn. Never prepare before an upgrade and expect that receipt to survive it.
4. Start once and recover by the same durable receipt. Complete verifies process/conversation, not package version; do not equate a new PID with a successful upgrade. Serial restart/check of the explicitly selected set makes failures attributable; report a failure rather than continuing an unbounded repair loop.

## API

Routes are under `/api/v1`. These existing restart routes predate the coordinator OpenAPI inventory; use this playbook and [API notes](../api.md#explicit-agent-restart) when absent from the served contract.

GET `/hosts/{HOST_ID}/agents/restart` with URL-encoded fields:

| Field | Evidence |
| --- | --- |
| connection_revision | Fresh configured machine revision |
| session / window / pane | Exact stable `$SESSION` / `@WINDOW` / `%PANE` |
| instance | Matching queue `attention.instance`, verified by conversation detail |

The response includes `{id,state,provider,session,project,command,note}`. Here `session` is the native provider conversation UUID, **not** the tmux session ID; keep those identities separate. State prepared is a persisted plan valid for120 seconds. Preparation requires exactly one process-linked native session, validated log/directory and supported installed CLI. It sends no native input. The command is fixed provider resume (`codex resume UUID`, Claude `--resume UUID`, pi `--session FILE`, with backend-supported fixed options). Preserve provider-home/session-directory configuration. Do not fabricate resume IDs or silently start a new conversation.

Before POST, save private local intent under ignored `.local/coordinator-restarts/`, with directories0700/files0600, rejecting symlinks and overwrites. Retain CC origin, host/endpoint identity, exact old target/instance/conversation, receipt ID, reviewed provider/project/command and phase; atomically mark attempted before IO. Receipt recovery needs only the original host and opaque id. This local record is not permission to start an expired/previously attempted operation again.

POST `/hosts/{HOST_ID}/agents/restart` with exact configured Origin and `{"id":"PREPARED_RECEIPT_UUID"}`. No extra command, model, approval flag, target override or prompt. The backend durably claims the receipt before IO and checks endpoint/process, directory/log and installation identity again immediately before replacement. It replaces the selected pane's shell/agent/children using fixed native resume; window/pane identities and sibling processes remain. Unsaved work/active tools may be interrupted, so stay within the human's actual maintenance scope.

Response `checking` means the attempt was recorded; it is not proof of success. GET `/hosts/{HOST_ID}/agents/restart-status?id=RECEIPT_UUID` observes the restart marker, replacement foreground identity and exact resumed conversation. Complete transfers original card name/notes/color/pin without overwriting newer edits. Status observation uses the recorded stable endpoint fingerprint for unchanged-host recovery across backend restart; a changed route/host or unrelated replacement fails closed. Prepared/complete receipts may return persisted state without fresh IO, so use a fresh queue/conversation read to establish *current* liveness after completion.

On lost reply, timeout, 5xx, conflict or continued checking, keep the original receipt and inspect status/pane read-only. Never repeat POST, silently prepare another restart, close/relaunch, switch sessions, bypass verification or answer native trust/auth/permission prompts. An old process still being visible is not permission to retry uncertain input. Stop bounded checking and report uncertainty if proof is unavailable. Future messages require a fresh grant for the verified new process; restarting does not migrate/replay old outbox intents or browser drafts. Tickets/launch receipts, native history and other agents remain untouched by the coordinator workflow.

Report the requested agent/machine, retained tmux target, native session, receipt and observed completion plus version evidence separately. This operation resumes the saved conversation; it does not reconstruct exact old CLI flags or apply package updates itself.
