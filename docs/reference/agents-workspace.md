# Agents workspace

Agents is a conversation workspace independent of the selected tmux window. Its list shows pinned/attention ordering and machine-qualified native agents. Status and message/approval capabilities remain backend-controlled; browsing or filtering never sends agent input.

## Finding agents

Search matches card names/notes, machines, harnesses, project paths and tmux names. Space-separated terms must all match and combine with the existing status/machine/project filters. Search is bounded and local to the already observed inventory, not a transcript/files scan. On desktop, `/` focuses search outside editable controls/dialogs. Arrow keys move from search to cards and between cards; Enter opens a card. Escape in search clears the query. Composer shortcuts remain owned by the composer. Compact clients search from the list; opening a chat preserves list/query and drafts. Filtering does not silently replace an explicitly opened conversation.

## Reading activity and usage

Consecutive completed tool calls and recorded thinking entries form expandable activity runs. Runs stop at chat messages, pending tools, errors or background work. Individual event details remain accessible inside a run. Expansion/focus and reading position are preserved across polling and older-history pages. Approval, question and folder-trust controls stay separate and explicit; a collapsed run never answers a request or implies completion of a still-pending action.

Card usage summaries show reported context use and capacity/percentage when known inside a single tinted bar. Cumulative tokens live in Settings → Token usage and conversation Token details. Missing capacities are omitted from the compact summary rather than guessed; fully missing usage is labeled Usage unreported. Exact counts, missing fields, provider cache semantics and source/as-of remain in Token details. The selected process-linked card and header use matching fresh counters; project-history, replaced-process or different-conversation counters never transfer to a live card. Disconnected counters remain Last observed. See [token metrics](agent-token-metrics.md).

## Outbox scope

**All outboxes** shows receipts across machines/processes and retains explicitly confirmed global bulk actions. **Agent outbox** freezes the selected machine/session/window/pane/process at opening and shows only matching receipts; previous processes and other agents remain in All outboxes. Global bulk controls are hidden and guarded in this scoped view. Individual receipt actions retain their original UUID, revision, delivery state and backend process/conversation/endpoint guards. Opening an outbox or changing selection never retargets or resends a receipt. Phone users can open the agent outbox through Details.

## Optional ACP agents

ACP brokers share the agent cards, filters, card metadata, notifications/read state and ticket context capture. Their badge identifies the protocol; selecting one opens broker-backed chat in the normal detail pane. Native launching/polling remains default. ACP launch preparation is internal to Start Claude (ACP). Prompts, permissions, cancellation and receipts use only the guarded broker path, never native terminal input. Explicit close is supported; busy-time queueing is capability-gated; unsupported general restart/resume is labeled honestly. See [ACP broker](acp-broker.md).


## Fresh Codex sessions before their first message

Native Codex may own a thread before its rollout is persisted. CC identifies that thread only through verified process/start evidence and a uniquely owned kernel writer lock or validated native runtime registration. It shows **New session**, with API activity still Unknown (`codex_pending`), rather than claiming Ready. Older project history is not that session. The current-session selector stays empty until native history exists; once the same thread materializes, CC follows it automatically, including after an accidentally selected old history. Explicit older-history browsing remains labelled and cannot send the fresh session's first message.

The first explicit CC message can initialize the native history without terminal input. Its one-use grant includes the exact process/session UUID and native screen; durable outbox metadata retains that anchor before transport IO. A conservative empty startup editor must still match at dispatch and immediately before paste. The initial supported boundary is the native `› Ask Codex to do anything` editor and `? for shortcuts` footer. Unknown layouts, typed drafts, update/trust/approval menus and replacement sessions do not receive input. Changed screens hold the message for explicit review, not automatic retry. There is no synthesized user message, auto-prompt, startup update answer or fabricated provider Ready state.

Once a transcript is persisted, Submitted becomes Seen only from matching user text in the same original native thread. An older conversation with identical text cannot confirm delivery. Missing or ambiguous kernel ownership stays unassociated. Provider histories, normal working/ready messaging and pi's separate deferred-log handling retain their original guards.

Codex and Claude cards and the conversation **Details** panel offer **Switch connection mode…** for an explicitly reviewed, exact-conversation native/ACP handoff. If its adapter is missing, the dialog offers a separate pinned isolated install, followed by a fresh switch review. Claude requires Node.js >=22 for that install. Native remains default; pi conversion and old brokers without handoff capability are unsupported. See the [handoff and installer details](acp-broker.md#switching-codex-or-claude-connection-mode).
