# Task 0016: Settings workspace and integration feature flags

Owner: CC dev
Claimed: 2026-11-05
State: done

## Goal

Replace the header Machines entry with Settings, containing Machines and Features. Persist installation-wide Slack/Email/Jira flags, default off for fresh installations. Preserve configured legacy integrations on first migration. Enforce disabled flags on all integration routes and stop hidden frontend activity. Retain source settings/receipts, machine edit guards, core workspaces/drafts and phone terminal isolation. No plugin extraction, credential changes or live external writes.

## Implementation

- Header Settings replaces Machines; a routed full workspace contains Machines and Features. Existing machine forms, SSH/ProxyJump tests, revision/conflict guards and discard prompts are preserved. Settings retains the prior workspace for Done and supports compact scrolling.
- Rust owns revision-checked flags in the private atomic `.features.json` sidecar. Fresh installs default Slack/Email/Jira off. Only first initialization migrates existing configured sources on; later explicit choices survive restart. Every integration route is guarded. Disable waits for active guarded handlers, then blocks new requests. Source permissions/configuration and durable metadata/receipts are retained.
- Frontend saves explicitly, hides disabled navigation, redirects disabled bookmarks/open workspaces to Settings, refreshes shared flags every ten seconds/on visibility, aborts hidden integration work, preserves conflicting drafts and rejects older GET responses after saves. Disabled bookmark navigation respects unsaved machine edits.
- Flags control runtime availability; this is not code extraction. Enable first, then configure the compatible personal-assistant source in that workspace. Enabling neither probes/installs a source nor grants write permissions.

## Validation

- `cargo fmt`; `cargo test --lib`: 42 passed; `cargo clippy --all-targets -- -D warnings`: passed; release build passed. Includes actual middleware/handler test proving save waits for in-flight IO and later requests return 403, plus fresh/migration/restart persistence tests.
- `npm --prefix web run build -- --outDir dist-next`: passed (existing bundle-size advisory).
- Isolated Settings/navigation suite: 12 passed, covering fresh flags, API gates, exact stale revisions, explicit saves/source retention, shared-client disable/conflicting drafts, bookmarks/reloads/history, unsaved files/machine forms, phone layout and simultaneous desktop terminal isolation.
- Integration/mobile/tmux batch: 60 passed initially; old modal machine-navigation assertion was updated for full-page Settings, then machine-management regression passed in the focused seven-test run. All other batch tests passed unchanged in behavior. Coverage includes synthetic Slack/Email/Jira, touch scrolling and local tmux fidelity; no live external writes.
- Isolated SSH suite: all four passed, including real local sshd/ProxyJump, host-key verification, connection tests and window mutations.
- Reviewed synthetic desktop/mobile Machines and portrait Features screenshots. Phone portrait/landscape Settings viewport checks pass without terminal sockets.
- `git diff --check`: clean.

## Deployment and limits

Deployed backend with existing loopback, LAN, tailnet and HTTPS-origin arguments; staged frontend assets retain earlier hashes. Private SQLite backup taken first. First-run migration preserved all three existing configured integrations as enabled; source setting hashes unchanged. Loopback/LAN/HTTPS health, Settings assets and flags verified. Broad session-membership comparison changed during viewer cleanup; subsequent distinct-pane check confirmed all 14 current pane processes predate restart and the known reported agent process is unchanged. No agent input/restarts or live feature toggles were used for validation.

Browser flags may lag another client's save by ten seconds; server gates apply immediately after commit. Already-running requests finish before disable commits. Integration code and local metadata still initialize in the binary; no plugin boundary or dependency extraction was introduced. No public repository audit/publishing was requested. Task 0009 legacy receipt choice remains pending.
