# Command Center

A Rust backend and web client for managing agents, tmux sessions and project work across local and SSH-connected machines. Built for responsive everyday use on a desktop or phone.

## Workspaces

- **Agents**: live agent conversations, activity, approvals, durable queued messages, launching and closing agents.
- **Tmux**: focused machine/session/window navigation, pane interaction and window management.
- **Files**: machine-qualified project browsing, code editing and Markdown preview with a table of contents.
- **Board**: persistent tickets and kanban, with links to machines, directories, tmux targets and agent launches.
- **Slack, Email and Jira**: integrations through configured source projects and the existing SSH transport, subject to source permissions.

Phone layouts focus on conversations and workspaces without attaching or resizing tmux. The web client can be installed on an iPhone home screen over trusted HTTPS.

## Quick start

Install a Rust toolchain supporting edition 2024, Node.js/npm, tmux and Python 3. Remote machines need tmux and SSH access; file/agent helpers require Python 3.10+. SSH uses your normal keys/config and verifies host keys.

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

Open http://127.0.0.1:8080. Use Machines to add local/SSH endpoints, including jump hosts. See [config.example.toml](config.example.toml). Existing installs should preserve their config rather than copying over it.

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
