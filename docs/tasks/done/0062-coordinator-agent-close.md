# Task 0062: Coordinator agent close permission

Owner: CC dev
Claimed: 2026-11-12
State: done

Human requests coordinator capability/permission to close agents. Existing GET/POST /hosts/{host}/windows/close already binds preview, connection revision, exact pane/process and affected window/session snapshot. Add a discoverable cc-close skill and REST playbook; align coordinator/parent instructions so explicit close or scoped delegated cleanup supplies authority without redundant consent. Describe whole-window collateral effects and uncertainty honestly (this API has no durable close UUID receipt/one-use token). No actual closures, agent messages, backend changes, deploy/restart or commit/push authorized by this capability request. Preserve uncommitted task0061 changes.

## Result and validation

Added `.claude/skills/cc-close/SKILL.md` in the coordinator workspace and `docs/reference/coordinator-closing.md` with exact existing GET-preview/POST body shapes, process/connection/window snapshot checks, collateral pane/linked-session effects and single-attempt/read-only uncertain recovery. Explicit human closure or explicitly delegated bounded cleanup supplies authority without redundant confirmation; ordinary messaging/Done/inactivity does not. Updated root/coordinator AGENTS, CLAUDE, README, cc-coordinate/cc-launch/cc-message routing and API guide. No backend changes, invented receipt/token or generic window-kill fallback. Local attempted metadata is distinct from nonexistent server close receipts.

Validation: skill-creator quick_validate passes new cc-close and all three edited skills. Coordinator helper tests13 pass (initial sandbox-only run could not bind its fixture listener; rerun with loopback access passed). Existing disposable Playwright close tests3 pass: authoritative card removal, mobile all-pane confirmation/cancel and no terminal attachment, SSH exact-process closure preserving unrelated panes/window. No new wording-mirroring tests. `git diff --check` passes.

No live closures, messages, ticket/outbox changes or deployment/restart. Existing coordinator should reread its updated AGENTS/CLAUDE/cc-close on next task; no automated message sent to it. Uncommitted task0061 status fix preserved. No commit/push requested.
