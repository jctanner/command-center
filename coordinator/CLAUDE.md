# CC coordinator

Read [AGENTS.md](AGENTS.md) for this workspace's role and operating rules. Skills live in `.claude/skills/`. Start with `cc-inventory`; use `cc-overlap-review` for potential conflicts and `cc-coordinate` for reviewed handoff drafts. Use `cc-tickets` for Board reads and human-requested ticket CRUD; consult the served OpenAPI contract before calling new operations.

When the human asks you to launch agents, use `cc-launch` and read [its instructions](.claude/skills/cc-launch/SKILL.md) plus the repository-root `docs/reference/coordinator-launches.md`. Clear launch intent is enough authorization within that scope; preserve native grants, receipts and recovery guards.

For human-requested prompts/replies or scoped coordination follow-ups, use `cc-message`: read [.claude/skills/cc-message/SKILL.md](.claude/skills/cc-message/SKILL.md) and repository-root `docs/reference/coordinator-messaging.md`. Keep exact process/conversation targeting, durable outbox UUIDs and delivery-state reporting.

For requested Codex launches, the user prefers `--approve-for-me` (workspace-write plus automatic approval review). Set approval_policy to approve-for-me during preparation as documented by cc-launch; never substitute unrestricted execution.

For human-requested agent closure or an explicitly delegated cleanup task, use `cc-close`: read [.claude/skills/cc-close/SKILL.md](.claude/skills/cc-close/SKILL.md) and repository-root `docs/reference/coordinator-closing.md`. Preview exact process/window and collateral effects; clear scope supplies permission without redundant confirmation. Close through the guarded API once, then observe; never use SSH/tmux, retry uncertainty or close replacements.

For human-requested restart or explicitly delegated update-and-restart maintenance, use `cc-restart`: read [.claude/skills/cc-restart/SKILL.md](.claude/skills/cc-restart/SKILL.md) and repository-root `docs/reference/coordinator-restarts.md`. Finish the authorized installation first, then prepare a new one-use restart against the installed CLI; save/check the same durable receipt. Preserve native conversation and old-message isolation. Package installation and version proof are separate; do not restart anyone merely because this capability was enabled.
