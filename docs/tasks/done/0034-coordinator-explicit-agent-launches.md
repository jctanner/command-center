# Task 0034: Coordinator explicit agent launches

Owner: CC dev
Claimed: 2026-11-08
State: done

## Goal

Authorize the coordinator to carry out explicit human agent-launch requests and give it exact existing REST workflows. Preserve native launcher identity/grant/recovery rules; no automatic launches from inventory/ticket status, no provider approval bypasses, and no live launch for this documentation task.

## Acceptance criteria

- [x] Consistent role/skills: explicit user launch intent is sufficient authorization; clarify missing/materially changed scope without redundant confirmation.
- [x] Launch skill/playbook documents Board-backed and standalone fresh launch preparation/start/recovery, names/models/destination, native session identity and durable receipt handling.
- [x] Verify examples against current schemas/handlers and helper signatures; no fictional CLI commands or expanded backend permissions.

## Validation

- Three JSON request examples validate against current OpenAPI TicketPrepare/TicketLaunch/ExpectedRevision schemas. Python example parses; BoardClient get/route/mutate availability/signature and local documentation links verified. Skill YAML header and diff whitespace checks pass.
- Cross-checked native Prepare/Start/Recovery and Board binding handlers: fresh host revision, canonical project, 120-second grant, ticket revision/prompt binding, optional target_session/model/names, one-use Start and recorded endpoint/launch UUID recovery. Standalone launcher remains documented outside the initial scoped OpenAPI slice; no nonexistent helper CLI commands advertised.
- Found naming limitation while reviewing handlers: backend-verified initial card naming is available through ticket record/check. Guide recommends ticket-backed launches for explicit card names rather than claiming standalone Start/status initializes metadata.
- Role and related skills distinguish explicit user launch permission from passive inventory/CRUD/draft permissions. No redundant generic confirmation when request scope is clear; no unattended orchestration, native auth/approval bypass, SSH/tmux workaround or uncertain retry.
- Documentation/skills-only change. No live launch preparations, starts, messages, provider settings changes or backend deployment performed. Runtime code/tests unchanged; Rust/frontend suites not rerun.

## Handoff

The running coordinator should reread its CLAUDE.md, AGENTS.md and new .claude/skills/cc-launch/SKILL.md before acting on its first requested launch. No message sent to it by this development agent. Clear user launch requests now authorize the documented guarded Board-backed/standalone REST flow, including literal initial prompt and private operation receipts. Existing provider/OS tool permission controls still apply.

Prior uncommitted Board/style/Claude-status work preserved. Changes uncommitted. Next task 0035, bug 0020.
