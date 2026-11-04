# Development and validation

Run commands from the repository root. Choose checks relevant to the change; respect the [operating rules](../AGENTS.md) and record actual results in the relevant [task](work-ledger.md).

## Rust

```sh
cargo fmt --check
cargo test
cargo clippy --all-targets -- -D warnings
cargo build --release
```

Use `--offline` for Cargo when dependencies are already cached. Integration tests require tmux and create isolated fixture sockets; they must never close live user windows.

## Frontend

```sh
npm --prefix web ci
npm --prefix web run build -- --outDir dist-next
CC_BINARY=../target/release/command-center CC_WEB_DIR=dist-next npm --prefix web test -- tests/agents.spec.ts
```

The browser config uses `/usr/bin/chromium-browser`; set `CHROME_BIN` to another installed Chromium executable if needed. CC_BINARY and CC_WEB_DIR are resolved from `web/`. Select the spec files relevant to the change: files, agents, outbox, launch, tmux, navigation, mobile scrolling, and integration workspaces each have focused suites. Some SSH fixture coverage requires an installed sshd.

Tests with actual sends/launches/closures use synthetic agents and isolated tmux/SSH fixtures. Do not replace fixture endpoints with live services. Use synthetic email/Slack/Jira data in test screenshots. Real phone installation, keyboard and safe-area behavior still need device verification.

## Provider and integration adapters

```sh
python3 -m unittest discover -s tests -p 'test_claude_continuation.py'
python3 -m unittest discover -s tests -p 'test_agent_history.py'
python3 -m unittest discover -s tests -p 'test_agent_activity.py'
```

Additional `test_agent_outbox.py`, `test_slack.py`, `test_email.py` and `test_jira.py` cover their adapters. `tests/pi_bridge.mjs` exercises the optional pi bridge. Do not report skipped/unavailable coverage as passed.

## Frontend development

Run the Rust backend on its default loopback port, then `npm --prefix web run dev`. Vite proxies the API and terminal WebSockets to that backend. Production serves built files directly through Rust; deployment details are in the [feature reference](reference/features.md#private-https).
