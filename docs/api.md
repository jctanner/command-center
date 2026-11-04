# API v1

All paths begin `/api/v1`. The service is loopback-only. Host must match its loopback address/port. Terminal WebSocket clients must send an Origin matching `http://HOST:PORT`; this is an origin check, not authentication.

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
