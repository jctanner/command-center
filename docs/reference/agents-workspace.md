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

ACP brokers share the agent cards, filters, card metadata, notifications/read state and ticket context capture. Their badge identifies the protocol; selecting one opens broker-backed chat in the normal detail pane. Native launching/polling remains default. ACP launch preparation is internal to Start Claude (ACP). Prompts, permissions, cancellation and receipts use only the guarded broker path, never native terminal input. Explicit close is supported; unsupported restart/resume and busy-time queueing are labeled honestly. See [ACP broker](acp-broker.md).
