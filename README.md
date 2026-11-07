# Command Center

A Rust backend and web client for managing agents, tmux sessions and project work across local and SSH-connected machines. Built for responsive everyday use on a desktop or phone.

**Early preview.** Linux is the tested backend and agent-host platform; agent discovery relies on Linux `/proc`. The Windows backend is unsupported and macOS backend behavior is unverified. Desktop and phone clients use the web interface.

## Security

**CC has no application login. Anyone who can reach a listener can control terminals, read and write files, and use configured SSH connections with the backend account’s permissions.** Host/Origin checks protect browser requests; they do not authenticate users.

Run CC on a single-user machine and keep access restricted to trusted clients. Loopback is the default, but other local users on a shared machine can reach it. Private LAN HTTP is unencrypted. For remote access, use a restricted tailnet or an authenticating HTTPS proxy; HTTPS alone does not add authentication. Protect every enabled direct listener so it cannot bypass your proxy or access rules. Do not expose CC directly to the public internet.

## Workspaces

- **Agents**: live agent conversations, activity, approvals, durable queued messages, launching and closing agents.
- **Tmux**: focused machine/session/window navigation, pane interaction and window management.
- **Files**: machine-qualified project browsing, code editing and Markdown preview with a table of contents.
- **Board**: persistent tickets and kanban, with links to machines, directories, tmux targets and agent launches.
- **Slack, Email and Jira**: optional integrations, disabled on fresh installs. Enable them in **Settings → Features**, then configure an existing compatible personal-assistant source environment and credentials on its machine. Source permissions still apply; CC does not install that environment or copy its credentials.

Phone layouts focus on conversations and workspaces without attaching or resizing tmux. The web client can be installed on an iPhone home screen over trusted HTTPS.

Choose **Settings → Appearance** for Command Center’s default palette or 23 Omarchy color schemes. Themes switch instantly across the interface, editor and terminal ANSI palette, with a preference saved per browser.

## Quick start

On Linux, install current stable Rust (the locked dependencies require at least Rust 1.89), Node.js 22.12 or newer with npm, tmux, and Python 3.10 or newer. Remote machines need tmux, Python 3.10+ for file/agent helpers, and SSH access through the backend’s OpenSSH client. SSH uses your normal keys/config and verifies host keys.

The clean-checkout build was verified with Rust 1.99.1 and Node.js 22.23.1. Minimum-version toolchains have not been tested.

On a fresh checkout:

```sh
git clone git@github.com:jctanner/command-center.git
cd command-center
npm --prefix web ci
npm --prefix web run build
cargo build --release
cp config.example.toml config.toml
./target/release/command-center --config config.toml
```

Open http://127.0.0.1:8080. Use **Settings → Machines** to add local/SSH endpoints, including jump hosts. See [config.example.toml](config.example.toml). Existing installs should preserve their config rather than copying over it.

The backend serves built assets from `web/dist`. Live configuration, integration settings, ticket/message databases, build outputs and reference checkouts are excluded from Git. Back up private runtime data separately.

## Remote and phone access

The default listener is loopback. Explicit private LAN/tailnet listeners and a configured HTTPS proxy origin are supported. Follow the [private HTTPS and iPhone setup](docs/reference/features.md#private-https) before remote access; raw HTTP and HTTPS origins have separate browser storage. Use the header's Reload app action after frontend updates.

## Development and project records

- [PLAN.md](PLAN.md): project direction, milestones and work index.
- [AGENTS.md](AGENTS.md): repository operating rules and safety constraints.
- [Work ledger](docs/work-ledger.md): claims, sortable filenames, bugs, ADRs and handoffs.
- [Architecture](docs/architecture.md): backend, transport and state design.
- [API](docs/api.md): versioned HTTP/WebSocket interfaces.
- [Feature reference](docs/reference/features.md): integration and interaction details.
- [Testing](docs/testing.md): build and focused verification commands.

Keep task progress, discoveries and evidence in the ledger. Keep this file focused on understanding and running the project.

## License

Licensed under the [Apache License, Version 2.0](LICENSE). Third-party dependencies retain their own licenses.
