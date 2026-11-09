# Bug 0021: Seen receipt removes message before history replacement

State: fixed

Independent outbox refresh removes a visible pending bubble as soon as its receipt is Seen, before conversation polling renders the native user message. This creates a visible disappearance/reappearance. Track only already-visible pending receipts during the exact process/conversation-scoped handoff; stop tracking once the native seen_message position is rendered. Old settled receipts must remain absent from chat. Task 0039.

Fixed in task [0039](../../tasks/done/0039-outbox-message-handoff-gap.md). Browser coverage holds history stale after Seen and simulates confirmation before the enqueue response; a single bubble persists until exact native replacement. Deployed frontend only.
