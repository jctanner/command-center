# Agent toolbar and chat tab

Task[0141](../tasks/done/0141-agent-toolbar-chat-tab.md) implements the human’s chat-widgets whiteboard direction. Desktop shows Start/search/Filters beside a docked folder-style active chat tab and actions. Filter tools and All outboxes are modal; native process outbox stays in Details. Same header/control nodes restore on compact screens. Clear filters preserves search; badges disclose active constraints. Errors remain visible, project-history identity remains explicit and modal-covered replies are not automatically acknowledged.

Build and59 distinct browser cases passed; native/ACP, bulk/scoped outbox, read-state, draft/resizing and pinned/conflict behaviors covered. Staged live screenshots under .local/reviews/agents-chat-tab-after-*.png and agents-filters-modal-*.png; no writes attempted. No backend changes, commit/push or deploy. Production remains task0140.
