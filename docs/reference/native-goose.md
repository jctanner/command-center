# Native Goose agents

Native Goose runs directly in a detached tmux session/window, using the same guarded launcher and polling transport as Codex, Claude and pi. Choose **Native tmux → Goose** in Start agent or Goose in ticket launch. Container ACP remains a separate opt-in path; installing native Goose does not convert or restart container agents. Native↔container ACP conversion is not implemented.

The initial container-only development rule was explicitly retired by the human on2026-11-18. Native Goose installation/use is allowed, including on rhlaptop. Ordinary launches still require an already installed executable and normal host provider configuration/authentication. CC never silently installs a harness or configures credentials during Start. Leave model blank for Goose's own default, or supply a validated literal override. Provider setup/permissions/telemetry dialogs remain native human interactions. Do not copy container state, secrets or conversations into a native home as a workaround.

## Launch and identity

The existing standalone `/hosts/{host}/agents/launch-options` and ticket prepare accept `provider:"goose"`, with canonical host path, model, optional project venv and tmux destination. Preparation and Start retain their expiring one-use endpoint/directory/executable guards and durable receipt/recovery rules. Goose rejects Codex approval modes and exact-directory pre-trust. Named/existing tmux sessions work as for other native harnesses; clients never attach or resize another terminal.

A fresh empty launch runs `goose session --name cc-<launch UUID>`. An initial task prompt uses `goose run --interactive --name cc-<launch UUID> --text <literal prompt>`. The unique name lets CC associate the process with the exact session row before its first message. Resume/restart runs `goose session --resume --session-id <saved ID>`; Goose IDs such as `20261118_1` are not UUIDs. Only explicitly selected project conversations may be resumed, and known running conversations are rejected.

Discovery verifies the foreground process/start/TTY and recognizes interactive Goose, excluding ACP, servers and noninteractive runs. Explicit process `--session-id` or an unambiguous `--name` provides association. A shared SQLite descriptor, newest row, directory or single candidate alone never proves the running session. Ambiguous manually launched sessions can appear with unverified project history. Use an explicit native session ID when resuming manually if process linkage is needed. Fork/edit/no-session modes do not reuse a claimed association.

## History and messaging

Goose's native SQLite is read-only: `~/.local/share/goose/sessions/sessions.db`, respecting `XDG_DATA_HOME` and the provider's absolute `GOOSE_PATH_ROOT` (`data/sessions/sessions.db`). CC does not initialize/migrate the database or persist a duplicate transcript. Queries have short timeouts/progress bounds, at most20 project candidates and100 rows/page with bounded JSON/text. WAL changes invalidate cached pages. Only user-visible human/assistant text appears as chat; reasoning, tools, hidden metadata and other sessions are excluded. This first native slice does not expose Goose tool activity or token metrics.

Activity is **Unknown/unverified**, since persisted messages are not a reliable turn lifecycle feed. CC does not infer Ready from the last assistant row or terminal silence. Requested messages can dispatch at a separately guarded input boundary: exact foreground/start and linked conversation, supported empty Rustyline editor at its current cursor, and a thread blocked reading stdin. Screen/conversation/process are checked again immediately before paste. This is not automatic approval. Unrecognized editors, partial drafts, permission/setup dialogs or unavailable process probes keep queued input pending; explicit Submit now remains subject to the existing human terminal-review guards. Busy input waits for the next verified empty editor rather than claiming Goose supports busy-time steering.

The durable outbox retains UUIDs and uncertain-delivery rules. Receipts use per-session row positions, database identity and normalized human text hashes, not offsets into the shared database; unrelated sessions cannot acknowledge input. Restart retains the exact native session, provider-home/venv environment and process guard. Close retains ordinary guarded whole-window semantics. Neither action silently substitutes a new conversation.

## Verification

Task0121 records a real Goose1.60.1 test on rhlaptop with an isolated tmux server, temporary provider home and local mock model: native launch/input, persisted chat, receipt positions and same-session restart passed. No real provider credentials were used; temporary settings/sessions were removed. Host installation used the official Linux release with its published SHA-256. No production CC deploy is implied.

Official references: [CLI commands](https://github.com/aaif-goose/goose/blob/main/documentation/docs/guides/goose-cli-commands.md), [session storage](https://github.com/aaif-goose/goose/blob/main/crates/goose/src/session/session_manager.rs), [input editor](https://github.com/aaif-goose/goose/blob/main/crates/goose-cli/src/session/input.rs).
