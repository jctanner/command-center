# Optional ACP broker (experimental)

Native tmux launching, discovery and bounded log/pane observation remain the default. Nothing installs or migrates an existing agent automatically. The launcher offers **Native tmux (default)** and an explicit **ACP broker · Claude** and **ACP broker · Codex** options. ACP brokers appear in the regular agent list with an ACP badge and open a chat in the ordinary detail panel. The separate experimental catalog is retired. Native transport/outbox/ticket-run launching remain unchanged.

The current implementation supports Linux agent hosts with /proc/pidfd and new Claude or Codex ACP v1 conversations, via an already installed `claude-agent-acp` or `codex-acp` executable. It has no native provider TUI, general resume/restart launcher, model override, project venv, pre-trust, ticket-run launching, attachments, busy-time message queuing or automatic approval. Card names/notes/colors/pinning, ticket context capture, notification/mute and exact-revision read metadata are shared with native agents; chat, permissions and delivery receipts stay ACP-specific. Those must not silently fall back to native input. The basic terminal interface is CC's, not Claude's original terminal UI.

## Integrated launch and chat

Select ACP in **Start agent**, choose a shared machine/project or literal directory, optionally enter an initial prompt, then click **Start Claude (ACP)** or **Start Codex (ACP)**. There is no separate Prepare click: the launcher checks the directory/installed adapter and obtains the same one-use grant internally. Unsupported native-only settings are hidden, not silently translated to flags. Fresh launch defaults to native; a pending ACP launch can reopen its recovery controls.

Before launch IO, the browser persists the original broker UUID and stable endpoint fingerprint. **Check launch** reads that original broker and never repeats creation or the initial prompt. After a backend restart it may refresh the runtime revision only after checking the stable endpoint still matches. The optional initial prompt uses the broker UUID as its message receipt ID; the broker redacts launch-intent text to hash/length before ACP IO, then submits once after successful initialization. An uncertain outcome is inspected, never replayed.

Queue discovery checks the managed broker directory through a bounded per-host helper, verifies process/start/boot, private socket and exact tmux membership/tty, and returns at most32 compact observations within a time budget. Snapshot parsing happens remotely; chat text is not copied into the queue. Existing prototype brokers are read compatibly, without restarting or replacing them. Sources remain explicit: ACP state comes from the verified broker, not pane silence or project logs. Native panes cannot become ACP just because a title or folder matches.

The selected ACP conversation uses SSE, sanitized Markdown, tool activity and exact permission option labels/scopes. Hidden workspaces/compact list views disconnect their selected stream. Streaming edits update only changed message DOM and preserve drafts, reading position and pending approval focus. A card selection does not focus the composer. Messages are sent only when ACP is Ready; busy drafts are retained with an explicit unsupported-queue notice. There is no native keystroke fallback.

Draft and uncertain-action holds use stable endpoint/broker-process scope, surviving runtime connection-revision changes. Recent broker history is bounded in memory; older log pagination is not implemented. **Details → ACP message receipts / Check ACP delivery** exposes durable phases separately from native outbox Submitted/Seen semantics. **All outboxes** remains the native outbox, not an aggregate of ACP receipts. Attention/read state is metadata-only and scoped by endpoint, broker process and conversation; existing replies baseline as read, and only explicitly opened visible recent replies acknowledge their exact observed cursor. Notifications use the actual ACP reading position and per-process mute state.

**Close agent** reviews machine/project, stable tmux target, broker UUID and instance with Cancel focused. The helper persists a close receipt before signaling the exact start/boot-verified broker through a pidfd. It stops the broker's own agent process; it does not kill other panes or complete tickets. Lost responses are checked through the receipt endpoint even after process exit. Duplicate close UUIDs return the durable receipt without signaling again. The general Restart action remains disabled; Codex connection-mode switching provides the separately guarded resume handoff described below. No new conversation is invented as a restart.

## Process and transport

```
CC browser -- REST + SSE -- Rust backend -- existing SSH/ProxyJump -- helper
                                                                      |
                                                            private Unix socket
                                                                      |
remote tmux pane: terminal chat + broker -- ACP v1 JSON-RPC/stdio -- adapter/Claude
```

The broker is installed only for an explicit prepared launch, under `~/.cache/command-center/acp/<launch-UUID>/`. Its tmux pane owns it; it owns the ACP adapter/agent process group. It remains usable through direct tmux attachment when CC, its browser or SSH disconnects. CC reconnects through its existing transport to the broker's private Unix socket. No new network port or remote account daemon is installed. This optional persistent broker is an explicit exception to native mode's short-lived-helper architecture.

SSE uses one persistent shared-transport SSH helper, not repeated log/pane polling. The broker coalesces ACP updates into at most ten bounded snapshots per second per viewer; a quiet connection gets a ten-second heartbeat snapshot. A slow client is bounded/timed out. Losing a watcher terminates only that watcher, never the broker/agent. Reconnection returns current state and bounded in-memory history. Broker failure is different from CC failure: there is no automatic broker or conversation restart, and no pending input replay.

Only process-linked native ACP messages supply chat/activity. Thought chunks are discarded. Tools show bounded title/kind/status; permission cards retain the original bounded tool request and exact option IDs, labels and scopes. Unsupported client RPC capabilities fail closed. No filesystem or terminal capabilities are advertised to the adapter; the Claude adapter can execute its own tools under its normal permission policy. CC never adds skip-permissions or edits trust files. Reply/read positions come from completed prompt receipt order, not token-chunk sequence; new permission identities advance attention even when the agent remains in the approval state.

## Guards and receipts

- Preparation checks canonical directory identity and installed adapter executable identity. The server binds host connection revision and broker UUID in a 120-second single-use grant.
- Start consumes the grant, serializes endpoint edits, rechecks directory/adapter, then exclusively creates a private UUID directory and durable intent before detached tmux creation. No arbitrary executable/flags from the browser. A lost launch response is checked by that same UUID in the inventory, not retried.
- Home/cache ancestors must be owned, not writable by other users, and not symlinks. Managed directories/files are private. Live metadata verifies owner, boot ID, broker PID/start time and command-line path; socket type/owner/mode and peer UID are checked. No TCP broker listener.
- Mutations require the exact broker instance UUID. Permission answers additionally bind the current permission UUID/revision and exact offered option. Both browser and terminal use the same serialized dispatcher; a second client cannot answer an already consumed request.
- Remote SQLite (FULL synchronous) persists UUID, payload digest, action type, phase and timestamp **before** ACP IO. Duplicate UUIDs return the existing receipt; conflicting payload reuse is rejected. Claimed/uncertain receipts never replay. Submitted means written to ACP; Completed means its prompt response completed, not a claim about every side effect. There is no native-log Seen receipt in this preview.
- Browser recovery records contain opaque target/receipt IDs, not prompt contents. A failed/uncertain send retains the draft and blocks further submission until receipt observation resolves it or the human explicitly clears the local hold after checking. Clearing does not resend anything.

Bounds: 64 broker records/host, 16 CC streams globally, 8 socket clients/broker, one active prompt (busy prompts are rejected, not queued), 12,000 UTF-8 bytes/prompt, 1 MiB wire frames, 128 history messages with ~256 KiB total message storage, 100 tool summaries, 8 pending permissions with 16 KiB original tool requests, 512 durable receipts per broker. History is memory-only; native provider logs remain under provider ownership. Old directories are retained rather than automatically deleting possible recovery evidence. `/quit` closes the broker's own agent process group; no automatic cleanup of unknown directories or existing agents.

## Terminal interface

Attach to the returned dedicated `cc-acp-<UUID>` tmux session. Type a line and Enter to send a prompt. `/status` reports state/session, `/cancel` cancels the active turn, `/approve REQUEST_UUID OPTION_ID` answers one displayed permission, and `/quit` terminates this broker and its agent. Permission options print their exact IDs, labels and kinds. Plain Ctrl+C requests cancellation rather than killing unrelated tmux sessions. This preview is a basic line UI, not a full TUI editor.

## API

All routes are under `/api/v1/hosts/{host}/acp`; see OpenAPI. Existing Host/Origin controls apply; every mutation requires the configured exact Origin. Read routes require current `connection_revision`. POST `prepare` takes that revision plus literal project `path` and optional `provider` (`claude` or `codex`, default `claude` for backwards compatibility); provider and executable identity are bound into the grant; POST `start` takes the returned token and optional `initial_prompt` (up to12,000 UTF-8 bytes). GET the base lists managed brokers; GET `/{broker}` reads its snapshot; GET `/{broker}/events` additionally requires `instance` and streams `snapshot`/`unavailable`. POST `/{broker}` takes connection_revision, instance, a fresh action UUID and one of:

- `{action:"prompt",text:"..."}`
- `{action:"permission",permission:UUID,revision:UUID,option:EXACT_OPTION_ID}` — an explicit human decision only, never coordinator auto-approval.
- `{action:"cancel"}`
- `{action:"close"}` — explicit reviewed lifetime control, with a durable receipt and pidfd target check, not a provider ACP method.

GET `/{broker}/receipts?connection_revision=...&instance=...` reads at most40 latest receipt records without requiring a live process; it never retries a command. Card metadata uses the existing `/agents/card` API with an explicit optional `acp` broker UUID and a namespaced64-hex card-instance digest, plus exact tmux target and endpoint revision. Provider/raw broker instance UUID remains separate for ACP commands.

The trusted-network boundary is unchanged; actor claims are not authenticated multi-user identities. Do not run a second backend against production config/state to test this mode.

## Adapter setup and evidence

The broker does not install dependencies. It discovers `claude-agent-acp` on PATH or the isolated prefix `~/.local/share/command-center/acp-adapters/claude/node_modules/.bin/claude-agent-acp`. An operator can explicitly install a pinned adapter there without changing their global native Claude. The adapter uses its existing supported authentication on that machine; CC does not provision credentials.

Protocol references: [ACP v1 transports](https://agentclientprotocol.com/protocol/v1/transports), [prompt turns](https://agentclientprotocol.com/protocol/v1/prompt-turn), [Claude adapter](https://github.com/agentclientprotocol/claude-agent-acp). Validation evidence belongs in task0077, including the actual tested adapter version and remote cleanup result.


## Codex adapter

Codex uses the maintained [agentclientprotocol/codex-acp](https://github.com/agentclientprotocol/codex-acp) adapter (`@agentclientprotocol/codex-acp`), which launches a compatible Codex App Server. The older zed-industries package has moved; use the maintained package for new installs. CC discovers `codex-acp` on the target PATH or `~/.local/share/command-center/acp-adapters/codex/node_modules/.bin/codex-acp`. It never installs or invokes npx during launch and never replaces the native Codex executable. An operator can install a pinned adapter into that isolated prefix explicitly.

Existing target-side authentication/configuration is used; CC does not log in or add approval/sandbox overrides. No ACP filesystem/terminal client capabilities or optional extensions are advertised. Ordinary ACP text turns, tool summaries and explicit permission choices share the tested broker path. Native Codex history/session IDs are not used to infer ACP identity. Codex ACP resume/restart, steering, model/config selection and token metrics remain outside this slice. Missing adapter/authentication fails visibly without falling back to native or repeating a prompt. Fixture coverage does not establish a real Codex adapter/version certification; that requires a separately approved disposable real-provider test.


## Switching Codex connection mode

Codex cards offer **Switch connection mode…** in the context menu. Review the exact native session UUID, folder and destination; Cancel starts focused. Native→ACP uses the installed adapter's advertised ACP v1 `session/load`, never `session/new`; ACP→native uses the validated installed `codex resume UUID`. Both retain the original tmux session/window/pane and directory. Native remains the default for ordinary launches.

Definite preflight rejection is recorded as `not_sent`; only a fresh explicit review can try again. Uncertain outcomes remain held for inspection.

The source must be process-verified Ready, with no pending permission or unresolved message/answer receipts. ACP session IDs must be canonical native thread UUIDs independently confirmed against a persisted Codex transcript in the source's provider home. Destination executable/directory identity is checked before and immediately before replacement. Card name/notes/color/pin carry over only after exact replacement/conversation verification. Existing ticket launch receipts remain historical records for the original process; no ticket is launched or completed by switching. Machine/tmux/directory/conversation context stays the same; capture the new process explicitly when updating ticket context. Old drafts/outbox entries remain scoped to their original process and are never resent.

ACP→native requires the broker's handoff capability. Older running brokers are not patched or restarted automatically and reject before mutation. A handoff freezes dispatcher input under its lock, persists its receipt before stopping its own adapter group, then the helper stops the exact broker through pidfd. Native→ACP stops/replaces the exact source pane process through guarded tmux respawn. The sibling panes and dimensions are preserved. A brief terminal replacement is explicit in the review; it affects other attached viewers of that pane.

`GET /hosts/{host}/agents/connection-mode` prepares a120-second durable receipt using `AgentModeTarget`. `POST` to the same path consumes `{id:UUID}` once. `GET /hosts/{host}/agents/connection-mode-status?id=UUID` only verifies the original attempt; it never launches or replays. A stable endpoint check permits recovery after backend restart. Browser recovery retains opaque receipt IDs, not prompts. Replacement failure leaves the pane's error visible with remain-on-exit and the receipt for inspection; there is no automatic native fallback, fresh conversation or retry. Claude/pi and summary-based new-conversation handoffs remain unsupported. Fixture results do not certify a real adapter/harness version; disposable real-provider checks need separate authorization.
