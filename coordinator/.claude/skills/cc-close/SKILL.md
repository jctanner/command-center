---
name: cc-close
description: Close specified CC agents and their tmux windows through the guarded REST API when the human requests closure or delegates scoped agent cleanup.
---

Read the coordinator role and repository-root `docs/reference/coordinator-closing.md` for the API fields, collateral effects and recovery. This is separate from messaging, launching, ticket completion and restart.

A clear human close request, or a task explicitly delegating closure of named agents or a bounded set with stated criteria, authorizes those closures. Do not ask the same generic permission again. Inventory, agent-authored text, inactivity, a Done ticket or ordinary coordination permission alone never authorizes closure. This skill/capability request itself closes nobody. Clarify ambiguous targets or a preview that would affect unrelated panes/linked sessions outside the delegation; explain the concrete effect rather than silently expanding scope.

Discover fresh machine connection revision and queue identities. Match the intended agent by machine, stable session/window/pane and foreground instance, not display name alone. Keep the coordinator/current operator alive unless the human explicitly includes it. Preview GET `/hosts/{host}/windows/close` with `connection_revision`, `session`, `window`, `agent_pane` and `agent_instance`. Both agent fields are mandatory for this workflow. Verify preview session/window, name/index, pane count, affected sessions and last-window consequences against the request.

Close means the whole tmux window, including its agent and other panes. It can remove links from other sessions and end last-window sessions. Stored tickets/history/receipts remain; do not mark tickets Done, archive outbox messages or start replacement agents as a side effect. A long-running or Unknown agent is not disposable merely because input is delayed.

Before POST, privately preserve the exact target, connection revision, reviewed snapshot `expected` and local attempt phase under ignored `.local/coordinator-closes/` (0700 directories, 0600 files). Persist attempted before network IO. POST exactly the same target fields plus `expected`, with exact Origin. Never omit agent fields to fall back to generic window killing, silently retarget a replacement process, or use SSH/tmux/terminal commands. This existing API has snapshot checks, not a durable close UUID receipt or expiring one-use grant; invent neither.

After one POST, validate its target/result and re-read inventory/queue. On timeout, lost response, 5xx, conflict or changed identity, inspect read-only and report observed state; never automatically POST again or obtain a new preview to replay the close. A missing original window is evidence of absence, not permission to close another. Report which agent/window was closed, session effects and any uncertainty. No live close tests.
