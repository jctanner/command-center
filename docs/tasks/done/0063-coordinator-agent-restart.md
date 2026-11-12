# Task 0063: Coordinator agent restart after package updates

Owner: CC dev
Claimed: 2026-11-12
State: done

Human requests coordinator restart capability for updated Codex/Claude/pi installations. Existing backend already prepares a process-linked resume command against current installed executable, binds installation/directory/log identity and records a one-use durable receipt before respawn. Add cc-restart/role/API playbook, explain update-first/prepare-after sequence and version-evidence limits. No generic package execution endpoint, no actual updates/restarts/messages or deploy/commit/push authorized by enabling this capability. Add meaningful fixture regression for newly installed bits and stale installation preview.

## Result

Added coordinator cc-restart skill and `docs/reference/coordinator-restarts.md`, plus aligned parent/coordinator AGENTS, CLAUDE, README and coordinate/message/launch/close skill routing. Explicit restart or maintenance scope including bounded restarts supplies authority without redundant confirmation. Package installation remains separately authorized; use cc-message for an assigned machine-agent update task, finish installation, then prepare against current installed executable. Preview review includes installed CLI path and exact native conversation. Durable receipt/attempt saved privately before one POST, GET-only same-receipt recovery, no uncertain retry/close-relaunch workaround, no replay/retarget of old drafts/outbox. Clearly distinguish retained tmux session IDs and native conversation UUID, installation/version evidence and process restart completion, dead-after-reboot resume and live process restart. No generic package/shell endpoint, backend code or live agent action added.

## Validation — 2026-11-12

- skill-creator quick_validate: new cc-restart and edited cc-coordinate/cc-message/cc-launch/cc-close valid.
- Coordinator helper suite: 13 pass with isolated loopback fixture.
- Existing restart Playwright suite plus four new package-update regressions: 15 pass. New fixtures atomically replace installed fake Codex/Claude/pi executables, then show exact saved conversation and new executable output after one restart; stale pre-upgrade receipt cannot respawn/kill the original, and repeated POST remains rejected. Existing tests cover all providers, siblings/pane identity, card transfer, old-message isolation, stale process, lost response across client/backend restart, wrapped agents and foreground ambiguity. All fixture-only, no real providers/packages/agents affected.
- `git diff --check`: pass. No production TypeScript/Rust changes, deploy/restart or extra build needed.

No live updates/restarts, coordinator messages, ticket changes, commit or push. Current coordinator can read updated AGENTS/CLAUDE/cc-restart on next task; not silently notified. This completes capability/instructions, not a maintenance run.
