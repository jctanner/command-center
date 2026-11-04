# Plan 0001: Command Center overview

## Direction

A responsive Rust service and web client for agents, machine-qualified tmux sessions, project files/Markdown, and connected work. Existing workspaces include Agents, Tmux, Files, Slack, Board, Email and Jira. Future TUI/native clients can share the versioned backend API; they are not implemented by adopting this ledger.

## Current phase

Documentation foundation completed: clear entry points and a durable evidence-based work ledger. See [milestone 0001](../milestones/0001-maintainable-project-records.md).

## Subsequent work

Choose the next user-prioritized change, define its acceptance criteria in a numbered task, and link it from PLAN.md before implementation. The user has stated CC-1 remains ongoing; the live Board remains authoritative for that ticket. Do not invent a product backlog or migrate board data as part of documentation work.

## Constraints and references

- [AGENTS](../../AGENTS.md): operational constraints and testing rules.
- [Architecture](../architecture.md): existing transport and state design.
- [API](../api.md): API reference and scope.
- [Feature reference](../reference/features.md): existing integration/interaction details.
- [ADR-0001](../decisions/0001-filesystem-work-ledger.md): ledger convention.
