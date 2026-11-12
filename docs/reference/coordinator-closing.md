# Coordinator agent closure

The coordinator may close agents when the human asks, or explicitly delegates cleanup of identified agents/a bounded set with stated criteria. That task supplies consent without another generic confirmation. This capability is separate from ordinary coordination, messaging, launch and ticket-edit permissions. A ticket becoming Done or an agent reporting completion does not itself authorize closure. Granting this capability does not select any live agents to close.

Use `coordinator/.claude/skills/cc-close/SKILL.md`. Resolve current targets through GET `/api/v1/hosts` and `/api/v1/queue`. Names alone are ambiguous: carry the machine ID, its current `connection_revision`, stable session/window/pane and `attention.instance`. Unknown/Working status is not evidence that an agent should be killed. Read the relevant context if the task's cleanup criteria require it; no terminal silence/newest-project-history inference. Do not close the coordinator/current operator unless explicitly included.

## Preview and effect

GET `/api/v1/hosts/{HOST_ID}/windows/close` with URL-encoded query fields:

| Field | Source |
| --- | --- |
| connection_revision | Current configured host connection revision |
| session | Exact `$SESSION` from discovery |
| window | Exact `@WINDOW` from discovery |
| agent_pane | Exact `%PANE` from discovery |
| agent_instance | Current `attention.instance` from the same target |

This is the existing endpoint used by Agents → Close agent. It predates the coordinator OpenAPI inventory; use this documented request shape if it is absent from the served contract. Agent fields are optional in the generic window API but **required for coordinator agent closure**. Never remove them to bypass process verification. The response is `{session,window,name,index,panes,affected_sessions:[{id,name,last_window}],expected}`. Review exact target, actual pane count and linked/last-window session effects. Closing kills the entire tmux window, including the chosen agent CLI and other pane processes; the live cards disappear. Unsaved work/drafts can be lost. Linked sessions are affected, and last-window sessions may end. Do not close a broader set or unrelated panes merely to complete a narrower request. If such collateral effects were not delegated, explain the observed preview and clarify. Clearly scoped dedicated-window closures need no additional click in the UI.

## One attempted close

Keep private local intent metadata under ignored `.local/coordinator-closes/`, with directory0700/file0600, no symlinks or overwrites. An operation filename may use a local UUID, but it is not a server receipt/idempotency key. Save the reviewed target, endpoint connection revision, preview expected hash and phase; atomically persist `attempted` before network IO. Never persist the observed process as a generic reusable target for future cleanup runs.

POST `/api/v1/hosts/{HOST_ID}/windows/close`, with exact configured Origin and JSON:

```json
{
  "connection_revision":"OBSERVED_CONNECTION_REVISION",
  "session":"$31",
  "window":"@33",
  "agent_pane":"%37",
  "agent_instance":"OBSERVED_PROCESS_INSTANCE",
  "expected":"REVIEWED_PREVIEW_EXPECTED_HASH"
}
```

The IDs above are illustrative; discover the requested actual target. Do not POST the example or add a fabricated receipt UUID. The backend serializes endpoint/window mutations, checks the connection revision and full window snapshot (pane PIDs, server identity, links, names/index), rechecks the agent instance, then the fixed helper verifies the foreground process before tmux window closure. It returns `{closed:true,session,window}`. Validate the response against the original target and refresh GET inventory/queue to report actual absence. No arbitrary PID-kill, terminal input, direct SSH or raw tmux escape hatch is part of this workflow.

The endpoint has no durable close receipt or expiring/single-use token. After timeout, 5xx, malformed/lost response or a process/window conflict, retain the attempted local intent and inspect GET `/api/v1/hosts/{HOST_ID}/inventory` plus queue with a fresh connection revision. Never automatically re-POST, silently obtain a fresh expected hash to retry, or target a replacement. Original-window absence confirms that it is absent; it does not identify who removed it or authorize affecting another window. If it remains, report uncertainty/staleness and resolve with the human before another attempt. Do not claim a disappeared card alone proves a close if the host is unavailable or the queue is filtered.

Closure does not modify tickets, resolve approvals, cancel/archive queued messages, transfer work, relaunch agents or erase stored conversation history. Existing process/endpoint-bound queued messages must not move to replacements. Those other operations require their own authorization/workflows.
