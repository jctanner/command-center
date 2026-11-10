# API v1

The [OpenAPI contract](openapi.json) is served at `GET /api/v1/openapi.json` by updated backends. It covers coordinator reads and all Board routes. See the [agent ticket guide](reference/agent-ticket-api.md) for full ticket CRUD, optimistic revisions, machine binding and recovery examples. Other APIs remain documented below and in the feature reference.

All paths begin `/api/v1`. The primary listener is loopback; optional explicit private LAN/tailnet listeners and an exact HTTPS reverse-proxy origin are supported. Host must match a configured authority. Browser Origin, when present, must match its configured scheme and authority; mutations require Origin. This is an origin check, not authentication: private network membership/access rules remain the deployment boundary. See [HTTPS setup](reference/features.md#private-https).

This document covers the original terminal, machine and file interfaces. Additional workspace/agent APIs are described in the [feature reference](reference/features.md) and implemented in `src/lib.rs` and each workspace module; it is not a complete endpoint inventory.

## HTTP

- `GET /health`: service status and package version.
- `GET /hosts`: configured host summaries (`id`, `name`, `remote`, `connection_revision`). No SSH keys or configuration paths are returned.
- `GET /hosts/{id}/inventory`: `{ "sessions": [...] }`. Session objects include stable `id`, display `name`, `attached`, and `windows`. Windows include stable `id`, `index`, `name`, dimensions, `active`, `zoomed`, and `panes`. Panes include stable `id`, `index`, geometry, `active`, and current `command`. Reserved viewer sessions are omitted. An absent tmux server returns an empty inventory; connection/command errors are failures, not empty success.

API failures use `{ "error": "message" }` with an appropriate HTTP status (unknown host: 404, unavailable host: 502). A configured host also defines the socket scope; IDs from different host entries must never be mixed.

## Terminal WebSocket

Connect to `/hosts/{id}/terminal?session=$0&window=@0&cols=120&rows=35`. URL-encode query values. Invalid targets are rejected; closed/moved targets produce an error event. There is a 16-connection limit (HTTP 429). Frame/message size is limited to 64 KiB.

Binary frames in either direction contain raw terminal bytes. Preserve byte sequences across chunk boundaries; they are not necessarily individually valid UTF-8. Send input only after a state event reports `session.attached: true`, and pause input while waiting for a requested window change. Never replay uncertain input after reconnect.

Client text frames are JSON:

```json
{"type":"resize","cols":120,"rows":35}
{"type":"select_window","window":"@2"}
{"type":"focus","window":"@2","pane":"%4"}
{"type":"zoom","window":"@2","pane":"%4","zoom":true}
{"type":"ack","bytes":16384}
```

`zoom` requests a desired boolean state rather than blindly toggling. `focus`/`zoom` must target a pane in the currently displayed window. After switching, wait for the requested window to be `active` in a state event before sending input.

Send an `ack` for each output chunk after the renderer consumes it. The count is bytes, not characters. Do not acknowledge more bytes than received. Output is throttled when acknowledgments lag. Clients must also handle normal WebSocket Ping/Pong/Close frames; browser WebSocket handles Ping/Pong automatically.

Server text frames:

```json
{"type":"state","session":{"id":"$3","name":"cc-view-...","attached":true,"windows":[]}}
{"type":"error","message":"window changed; try again"}
```

The state session is the connection's temporary viewer, not the original source session. Its window and pane IDs refer to the real shared tmux objects. State updates are emitted on change. Retain the original source session ID for reconnect; never reconnect to a reserved viewer. Reconnect obtains a new screen through a fresh tmux client. The protocol provides no exactly-once delivery guarantee for terminal input.


## Machine management

Mutation and connection-test requests require the same Origin header as terminal WebSockets. Send `Content-Type: application/json`. Bodies are limited to 16 KiB. Machine IDs are stable and server-generated for additions.

- `GET /settings/hosts`: `{ "revision": "opaque-token", "hosts": [...] }`. Each host has `id`, `name`, and optional `ssh`, `socket`, `ssh_config` fields. SSH configuration paths refer to files on the backend machine; socket paths refer to the target machine. This editor endpoint exposes paths, but never private key contents.
- `POST /settings/hosts/test`: a draft `{ "name": "devbox", "ssh": "user@10.0.0.20", "socket": null, "ssh_config": null }`; returns `{ "version": "tmux 3.7c", "sessions": 1 }`. It does not save settings or attach a terminal. Up to four tests run concurrently, with a 12-second timeout. A reachable host without tmux sessions succeeds with zero sessions; SSH authentication/host-key errors are failures.
- `POST /hosts`: `{ "revision": "...", "host": { "name": "...", "ssh": null, "socket": null, "ssh_config": null } }` adds a host.
- `PUT /hosts/{id}`: the same body replaces that host's editable fields while preserving its ID.
- `DELETE /hosts/{id}`: `{ "revision": "..." }` removes the configuration entry without killing tmux sessions. An empty host list is supported.

Successful mutations return the full updated settings and a new revision. Use that revision for the next change. Stale revisions or external configuration edits return HTTP 409; a save failure leaves the published settings unchanged. Settings are written atomically before publication. Local hosts must omit `ssh_config`; blank optional paths should be sent as null.

`GET /events/hosts` is an SSE stream. It sends a named `hosts` event containing `{ "revision": "...", "hosts": [...] }` immediately on connection and whenever settings change. The hosts are the same summaries as `GET /hosts`. Reconnecting delivers a complete current snapshot, so missed events do not need replay. `connection_revision` remains unchanged for alias edits and changes for SSH destination/socket/config edits; clients should reconnect only an affected selected machine. A removed selected machine should be deselected and its viewer disconnected, leaving the real tmux session alive.


## Projects and files

Locations are `(host ID, absolute path)` pairs. The host ID also identifies the configured tmux socket; a machine alias is never a lookup key. All file responses include `host` and the machine's `connection_revision`. These are filesystem operations under the backend/SSH account, without project-root access restrictions. Remote operations require POSIX Python 3.10+.

- `GET /hosts/{id}/projects` returns `{host, connection_revision, revision, projects, discovery_error}`. Projects contain `{path, name, pinned, windows}`; window references contain session/window IDs and names. Directories are deduplicated across pane working directories. Discovery failures retain pinned shortcuts and return a message instead of hiding them.
- `PUT /hosts/{id}/projects` takes `{revision, path, name, pinned}` to pin, rename, or unpin a shortcut. It uses the settings revision and returns updated machine settings. Pins are persisted in each host's `projects` array. Normal machine edits preserve them.
- `GET /hosts/{id}/fs?path=...&hidden=false&connection_revision=...` lists a directory. The canonical `path`, `entries`, `truncated`, and `unsupported_names` are returned. Entries contain `name`, absolute `path`, `kind` (`directory`, `file`, `other`, `unavailable`), `symlink`, and `size`. At most 2,000 entries are returned. Non-UTF-8 names are skipped rather than mapped to a different path. `~` and `~/...` expand on the target machine; other relative paths are rejected.
- `GET /hosts/{id}/file?path=...&connection_revision=...` reads `{path, text, version, read_only, host, connection_revision}`. The response path is canonical. Optional `known_version` returns `{path, version, unchanged:true, host, connection_revision}` when unchanged, avoiding transfer of file contents during checks.
- `PUT /hosts/{id}/file` takes `{path, text, version, connection_revision}`. The path must be the canonical read target. A successful save returns the new file response; stale content/metadata, changed location, or a changed machine connection returns 409. Missing files return 404; permissions/read-only return 403; unsupported binary/encoding returns 415; oversized text returns 413. There is no force-save bypass: explicitly replacing a reviewed disk version still supplies that exact version.

The file PUT route allows an 8 MiB JSON body to accommodate escaped text, but decoded UTF-8 content is limited to 1 MiB. There are eight concurrent file-operation slots; writes are serialized per machine without blocking terminals. Local I/O runs off the async executor; SSH operations use a bounded one-request helper and a 20-second timeout. Neither requests nor responses containing file contents are logged. The same-origin requirement applies to file and pin mutations.

Treat connection revisions as opaque and retain the one from the original read until the file is explicitly reopened. They change on connection edits and backend restarts. Clients must preserve drafts on 409, never silently retarget a save by substituting a newer machine token, and guard asynchronous reloads against edits made while the request was in flight.


## Explicit agent restart

- `GET /hosts/{id}/agents/restart?connection_revision=...&session=...&window=...&pane=...&instance=...` prepares a 120-second confirmation. Requires a unique process-linked native conversation and supported CLI installation. Returns an opaque `id`, provider, native session, directory and literal resume argument array.
- `POST /hosts/{id}/agents/restart` takes `{id}`. Durably claims that receipt once before replacing the selected pane process with the harness resume command. Other panes/windows remain. A repeated/expired start is rejected. The response is `checking`; no client or status read repeats the action after uncertainty.
- `GET /hosts/{id}/agents/restart-status?id=...` verifies the pane marker, new foreground-process identity and exact native conversation, then transfers original card preferences without overwriting newer edits. Status uses the recorded endpoint fingerprint so unchanged-host recovery survives a backend restart. Failed verification never transfers metadata. A browser retains only the opaque outstanding operation ID for recovery on reload.

Restart retains the tmux IDs and directory but replaces the selected pane's shell, agent and children. Keep unsaved work/active-tool interruption explicit. Old outbox records and drafts remain tied to the original instance for review; restarting never authorizes replay. `agent_restarts` in the private board database stores bounded operation receipts/verification plans, without conversation contents or credential environments. The additive table is compatible with existing version-2 database readers.


## New-agent initial prompt

`POST /hosts/{id}/agents/launch` accepts optional `initial_prompt` alongside `token` and `conversation`. Omit it, use null, or provide whitespace only to open interactively. A nonblank prompt is valid only for a new conversation, preserves literal content and whitespace, and is limited to 24,000 UTF-8 bytes with newline/tab control characters only. Invalid prompts and resume+prompt combinations are rejected before consuming the launch grant. Ticket-bound launches reject caller-supplied prompts and retain their server-reviewed ticket prompt.

The harness receives one positional argument after `--`, using the existing guarded local/SSH launcher. Prompts never enter launch-preparation URLs or browser recovery receipts. A lost response still uses Check launch to observe the same target; it never resends the initial prompt. The web launcher preserves a staged prompt across new/resume selection, disables it for Resume, and clears it after a verified successful launch.

For large argument payloads, the local/SSH helper uses a mode-0600 temporary argv handoff, checked and deleted by a fixed pane-side launcher before exec; tmux still receives only structured arguments. Launch HTTP/helper JSON envelopes are bounded at 160 KiB to accommodate escaping, independently of the 24,000-byte prompt limit. Successful startup does not retain a separate prompt handoff file.


## Observed background tasks

Queue items and agent conversation responses add optional `background_tasks` (null when unsupported/unlinked). The first implementation supports Claude process-linked native logs. A snapshot contains `source: claude_tasks`, `conversation`, `observed_at`, `tasks`, `limited` and `unavailable`. Each task has a provider task `id`, bounded `title`/`summary`, `state`, optional `started_at`/`finished_at`, and `updated_at` UTC epoch seconds. States are running, waiting, unverified, completed, failed and cancelled. Waiting covers explicit provider reports that a subagent is waiting on child work. Unknown native states remain unverified.

A successful async launch tool result produces activity status `background` (Started in background), not a claim of task completion. Completion/failure requires an explicitly provider-marked task notification for that ID. Human XML, sidechains, foreign sessions, malformed/future evidence and ambiguous tool-result metadata do not establish task state. Stale nonterminal evidence becomes unverified after 15 minutes; disconnected/stale client observations also display unverified. Foreground Ready/Working, send grants, outbox dispatch and reply/read cursors are independent.

Scans are bounded to the latest 512 KiB of the uniquely process-linked log and at most eight task rows. `limited` discloses truncated history/rows; this is observed recent evidence, not a complete task inventory or OS process probe. Status/details reuse the existing helper transport, adding no task-output-file polling or SSH connection. Background snapshots omit tool commands, prompts and task output-file paths. The web UI uses compact card badges and an expandable bounded chat panel with elapsed time, reported status and literal text. Raw notifications remain excluded from human messages.


## Wrapped agent discovery

Agent queue discovery supplements tmux's current-command hint with one bounded process-discovery request per host. A supported CLI can be inside a foreground shell wrapper: it must be the unique eligible CLI in the pane's foreground group, descended from the pane process, with the same controlling terminal and interactive stdin. Other process groups, redirected stdin and ambiguous candidates are excluded. Supported CLI group leaders remain primary over their delegated children.

The resolver checks at most 32 ancestry/descendant nodes and discovery considers at most 256 distinct live panes; existing per-host agent/time limits still apply. Status and actions re-resolve/revalidate the same target. Queue `agent` identifies the detected harness even when tmux reports bash. No transcript/window-name guesses or launch-script contents are used. Direct-agent process identity hashes remain byte-for-byte compatible; wrapped identities add the actual child and wrapper-start evidence. Detecting a process does not itself prove its native conversation identity; existing history-association labels and guards remain.


## Claude history after moving or resuming repositories

A uniquely process-proven Claude session can auto-select even when its log remains under an older project folder. Lookup uses the exact UUID from the validated PID registry, or explicit foreground CLI resume arguments when no valid registry session is available. It validates the current-project file first; otherwise a bounded lookup of at most 2,000 project entries accepts one matching regular file under the configured projects root, with matching native UUID metadata. Duplicate fallback matches, unsafe/symlink paths, mismatched metadata and invalid continuation edges do not auto-link.

Explicit continuation edges remain bounded and confined to that resolved file's project folder. Current verified registry sessions take precedence over stale startup arguments. No project-wide recency guess, log move/rewrite, process restart or native registry edit is required. A process can still report verified registry idle status before its log exists; log-derived activity and process history require the separately validated path.

## Installation features

`GET /api/v1/settings/features` returns `{revision, features: {slack, email, jira}}` with no-store caching. `PUT` accepts the same shape with the observed revision and literal booleans; mutations require the configured same-origin guard. Stale revisions return 409. Saving requires a configuration file; the private `.features.json` sidecar persists flags atomically. Disabled integration routes, including integration settings and send/recovery routes, return 403 before integration handlers run. Already-started requests finish before disable commits. Core APIs remain available. Flags do not override source permissions.

Terminal stream `error` events may include `scope: "connection"` for viewer creation/state-read failures. These are transient connection feedback and may clear on authoritative recovery; errors without this scope retain action-warning behavior. This field never authorizes retrying input or mutations. The shared header presents tmux connection state only in the tmux workspace; other workspaces do not inherit a selected machine's offline status.

## Codex injected context and visible-history revisions

Codex response-item user records can contain harness-generated interruption or environment context. Recognized internal content-item kinds with explicit native harness provenance are excluded from displayed messages, launcher titles and outbox user-confirmation evidence. Genuine human XML and ambiguous/mixed metadata remain literal. Native logs and structured interruption lifecycle state are unchanged.

Visible Codex history uses its own version prefix; clients should treat versions as opaque. A pre-filter known_version returns history_reset=true so open clients discard old cached pages. Native reply/receipt version and assistant cursors are unchanged by this presentation filter.

## Codex resumed-session association

A private runtime registration validated against the live PID/start/boot, pane and cwd identifies the current Codex session even when the process retains another startup thread's open rollout or writer lock. In that case only the registered native session is process-linked; other project conversations remain selectable as unverified history. Missing/invalid registration retains the existing lock/open-log/resume evidence and ambiguity checks. This changes no CLI process, native transcript, outbox intent or provider permission settings.

## Claude foreground readiness with background shells

Validated native Claude registry `status: shell` is treated as foreground Ready with a reason indicating reported background shell work. Claude derives this native state from an idle foreground; it is not an unrecognized state or proof of an active foreground turn. Background task observations remain separate, including unavailable/unverified status and completion evidence. Existing PID/start/session/cwd/tmux and timestamp checks apply, and newer verified foreground events override the registry. This change installs no hook and sends no input by itself; pre-existing human outbox intents can dispatch through their normal guards once readiness is verified.

## Codex launch approval policy

Standalone `GET /hosts/{id}/agents/launch-options` and Board ticket prepare accept optional `approval_policy`: omit/null/`default` for harness defaults, or `approve-for-me` for Codex automatic review with the workspace-write sandbox. Other nondefault values/providers are rejected. Preparation returns the normalized policy, checks the installed executable advertises the exact flag, and binds it into the one-use grant. Start cannot override it and rechecks support before creating a tmux target. Launch status and durable ticket run receipts retain the policy; old records read as null. This does not modify provider configuration, restart existing agents, disable sandboxing, or approve native dialogs through CC. Both frontend launchers offer the choice; changing machine/provider resets it and changing policy invalidates preparation.

## Codex guardian conversation association

Codex automatic review may keep an additional guardian thread writer in the same native process. Conversation discovery excludes session metadata explicitly marked source.subagent, source=subagent, or thread_source=guardian_review/subagent. Such histories do not participate in user conversation selection, Ready/Working evidence or outbox delivery confirmation. Main-thread owned writers remain required; two genuine roots stay ambiguous. Existing receipt conversation hashes and UUIDs do not change. This filtering does not approve tools, replay uncertain delivery or transfer queued messages.

## Busy native agent input

Durable queued messages dispatch to process-linked verified Ready or Working agents through ordinary bracketed paste and Enter. Each native CLI owns its busy queue/steering semantics; CC sends no interrupt. Pi requires a recognized empty editor bound to cwd/width while ignoring its output spinner. Busy Codex/Claude observations can refresh after SSH output advances, but still require a second exact screen fingerprint before paste. All helpers revalidate process, conversation, mode and approvals/dialogs immediately before paste. Changed input guards produce explicit pre-paste not-sent deferral of the same intent; post-paste/Enter or transport uncertainty is never retried.

Definite anchored Submitted receipts no longer wait for native-history Seen before later messages can be submitted in order. Unknown, blocked, uncertain and legacy unanchored receipts still hold the queue. Identical inputs need separate post-baseline, unused native message positions. A busy CLI can delay persisting its user record: Submitted honestly means terminal transport completed; Seen means the exact input appeared in the original native conversation, not that the model acted on it. No new request fields are needed on the public message endpoint.

## Pi native command receipts

Pi treats leading !/!! input as shell mode. Ordinary CC chat rejects this before paste and keeps the browser draft; prefix conversational references with FYI: instead. Historical Submitted/Uncertain receipts can become command only from exact post-baseline active-branch bashExecution metadata in the same process-linked log (conversation/device/inode), with a matching digest and unused position. Provider records must explicitly state context exclusion to distinguish ! from !!. Command output is never returned as receipt evidence.

The command outcome exposes command_message (native byte position), leaves seen_message null, and is not user-chat Seen or permission to replay. It is retained for explicit archival; Submit now and Check delivery cannot resubmit it. Existing uncertain/legacy cases without this proof remain unresolved.

Codex also emits a single environments.environment_context input_text item without optional content_item_metadata. Filtering recognizes only that observed envelope with a generated msg_UUID identifier, turn UUID and positive numeric create_time. Missing/invalid IDs, explicitly supplied contradictory metadata, mixed human content, other kind-only records and literal XML remain visible. The visible-history prefix is codex-visible-v2; old prefixes trigger history_reset without changing native log versions, reply cursors or receipt positions.
