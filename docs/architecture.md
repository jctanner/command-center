# Initial architecture

One Rust process owns live host configuration, tmux commands, SSH connections, and terminal streams. Axum serves a versioned HTTP/WebSocket API and the built TypeScript/Vite frontend. The frontend has no application framework and uses xterm.js through `web/src/terminal.ts`; the API contains no renderer-specific state.

## Terminal transport

The first implementation uses a native tmux client attached through `portable-pty`. Local hosts execute tmux directly; remote hosts execute it using system OpenSSH, a forced remote PTY, verified host keys, and a private per-host ControlMaster socket. Metadata commands reuse that SSH connection. Terminal bytes never travel through `send-keys` subprocesses or periodic screen captures.

Each browser attachment creates a uniquely named grouped session sharing the source session's windows. Window selection and session options belong to that viewer. Pane state, zoom, and dimensions remain native tmux state. Viewer status is hidden and mouse input is enabled only for the viewer. Original session options, user key bindings, and window-size policy are preserved. Existing clients are never forcibly detached.

This was chosen over control mode for the initial slice because native tmux renders its own pane layout and maintains terminal modes, initial screen contents, copy mode, and application interactions. Control mode remains a possible optimization for event-driven discovery or custom pane rendering; it would require additional terminal-state/bootstrap and layout work. Native rendering means the web UI currently uses tmux's borders rather than individually mounted pane widgets.

On Unix, input uses an owned duplicate of the PTY master descriptor: the library's default writer sends newline/EOF on drop, which is unsafe for an attached multiplexer. Dropping Command Center's writer closes the descriptor without injecting keystrokes. Viewer destruction on detach is enabled only after attachment. Normal disconnect explicitly detaches the viewer client, terminates its local PTY child, and verifies the generated session name before cleanup. SIGINT/SIGTERM close terminal connections before graceful server shutdown. A backend crash during the small pre-attachment setup window can leave a detached reserved viewer; automatic orphan recovery is not implemented.

## State and load

Stable tmux IDs are scoped by configured host/socket. Inventory retains session membership even when windows are linked. Browser selection lives in local storage; authoritative inventory and zoom state come from tmux.

Only the active browser window has a terminal stream. Selected-host discovery runs every two seconds while the page is visible; a per-host 1.5-second cache coalesces requests. Each attached viewer checks metadata every second (briefly every 100 ms until attachment). Commands publish updated metadata immediately. A slow host has its own timeout and inventory lock, so it cannot block another host's terminal.

Each terminal has bounded input/control/output queues, 16 KiB output chunks, and at most about 272 KiB of unacknowledged browser output. Clients acknowledge bytes after renderer parsing; output reading stops when that budget fills. WebSocket sends time out after five seconds and heartbeats detect dead connections. There are at most 16 simultaneous terminals. Terminal scrollback is capped at 5,000 lines and dimensions at 500 columns by 300 rows.

## Live machine settings

A registry separates editable host configuration from the transport held by each terminal. A name-only edit reuses the same transport and connection revision. Connection edits create a new transport/SSH control socket; existing terminal handles stay valid until their client reconnects. Removal drops the registry entry without terminating any tmux processes.

Machine mutations are serialized, validate an opaque settings revision, and compare the last-read configuration bytes to detect manual file changes. They write a synchronized temporary file beside the configuration and atomically replace it before publishing the in-memory snapshot. Failed validation, conflicts, and failed writes never publish partial settings. File I/O runs off the async executor. The default persistent file is `config.toml`; `--config` selects another file. Config-file watching is not implemented.

A watch channel publishes complete host-list snapshots over SSE to every browser. A snapshot includes a connection revision per machine so aliases/additions do not recreate terminal sockets. Editing an active connection reconnects only that machine's clients. Settings dialogs retain drafts after conflicts and require an explicit reload before retrying with the new revision. A separate bounded connection-test endpoint uses normal verified SSH transport without creating a viewer or saving a host.

## Machine-qualified projects and files

Pane inventory includes `cwd`. The tmux text transport length-prefixes this final field in bytes so quotes, Unicode, tabs, and newlines cannot become different paths or corrupt the next inventory record. Project discovery deduplicates those paths within the requested host/socket and merges persistent named pins from that host's configuration. Project identity is stable machine ID plus absolute path; project directories are navigation roots, not access fences.

Local file operations are Rust filesystem code on blocking workers. Remote operations invoke a small Python standard-library helper over the same verified OpenSSH transport/control socket, with JSON stdin and bounded JSON stdout. There is no deployed daemon or package. Python 3.10+ is a remote file capability requirement; terminal management remains independent. Tests check local/remote version parity and exercise real SSH file reads and writes.

Reads return canonical paths and revisions containing SHA-256 plus file identity/metadata. Writes require the original machine connection revision and file revision, check again before replacement, and synchronize a temporary sibling before atomic rename. Writes are serialized per machine and preserve permissions, ownership, and xattrs. Symlink retargets and stale files are rejected; hard-linked files are read-only to avoid silently breaking link relationships. Nonblocking/no-follow file opens prevent special files from blocking workers or replacing the target after resolution. These are optimistic conflict checks, not a distributed lock on external editors.

CodeMirror and language parsers load only when Files is opened. One editor view switches between per-document states, retaining selection/undo and unsaved edits. Tabs and histories use machine/path keys; machine renames only change labels. The browser stays put by default, with explicit follow-pane navigation. Delayed file responses can add a tab but cannot steal focus from a newer selection. Saves capture their document and content at invocation; newer edits remain dirty. Reloads refuse to replace edits made while a request was pending.

The active document is rechecked on focus and every ten seconds while Files is visible. Clean changes reload; conflicting drafts remain available with disk review and explicit version-checked replacement. Before-unload and dirty-tab prompts guard local drafts, which are not stored as file contents in browser storage. Backend restarts/connection edits conservatively invalidate file tokens, leaving old drafts visible but unable to write until explicitly reopened.

## Security and scope

The MVP binds only to IPv4 loopback and validates Host plus same-origin requests, including WebSocket handshakes and every settings mutation/connection test. It has no user accounts or network authentication. SSH forwarding is the supported remote-backend access method. Frontend text uses DOM text APIs; local commands use structured process arguments and remote shell arguments are individually quoted. Terminal content and keystrokes are not logged by the application.

Ghostty's [libghostty-vt](https://github.com/ghostty-org/ghostty#cross-platform-libghostty-for-embeddable-terminals) is a candidate for later native/browser clients. It supports WebAssembly, but its embedding API is evolving and adopting its VT engine still requires browser rendering/input integration. Keep that decision independent of tmux and the backend protocol.

## Performance validation

The browser suite reports local input-to-render latency, window-switch latency, reconnect time, and backend RSS. Echo measurements include browser automation overhead and window switching measures receipt of authoritative pane metadata. Run against release builds for a useful baseline. These smoke measurements are not a direct SSH comparison.

Initial release smoke results on the development Linux host (Rust 1.99.1, tmux 3.8, headless Chromium, local loopback): 10 echo samples gave median/p95 47/47 ms; 10 window switches gave 7/17 ms; reconnect took 25 ms; backend RSS was 8,016 KiB. These are one run, not a cross-machine guarantee. Initial local targets are p95 echo and window switching below 100 ms and reconnect below one second on this environment. Keep raw samples in browser test attachments and investigate regressions against repeated runs rather than treating these as WAN budgets.

Before calling this a replacement for direct SSH, benchmark the same machine/network with SSH + tmux, exercise noisy panes and sustained output, measure idle/active CPU and bandwidth, and test actual WAN disconnects. Validate Safari/iPhone keyboard/clipboard behavior and terminal-heavy applications manually. Native macOS/Windows and iPhone PWA support are not yet delivered.
