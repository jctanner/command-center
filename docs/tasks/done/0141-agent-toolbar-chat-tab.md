# Task0141: Agent toolbar/modal and desktop chat tab

Claimed2026-11-18 by CC-dev. Human approves Start/search/Filters-only toolbar, secondary filters/tools/global outboxes in modal, process outbox only in Details, and folder-style desktop active chat title in toolbar row. Preserve mobile header, guarded messaging/outbox scopes, drafts/selection/read semantics, keyboard/touch/filter state and native/ACP ownership. No backend changes or commit/deploy requested.

## Implementation

Primary toolbar now Start agent/search/Filters; the modal owns machine/project/status, attention shortcuts, Refresh, Clear filters and All outboxes. Active non-search filter count is visible. Global/process outbox scopes retained; duplicate process outbox removed from header and kept in Details. Checked-at moves into tools; actual errors remain visible. A pinned-order conflict message now survives subsequent renders instead of disappearing.

Desktop active native/ACP header is docked into a folder-style tab above the conversation, using the same title/buttons and an ownership anchor. Mobile restores the header to its original container. No duplicate controls, input focus or conversation reset. Metadata moved to Details description; project-history badge retained explicitly. Context meter remains a thin strip. Modal presence suppresses automatic read acknowledgements/notification reading, with explicit human Mark read unchanged.

Staged GET-only live screenshots at1440x900 and1366x768 show no overflow/browser errors and zero mutation attempts. Private .local/reviews/agents-chat-tab-after-*.png, agents-filters-modal-*.png and agents-chat-tab-after.json. Existing full chat-title row eliminated; root body itself gains4px and chat content gains the removed header space. Screenshot does not assert live broker availability (initial read-only SSE may still be connecting).

Validation results recorded on completion below. Initial legacy locator failures corrected for modal controls/scoped outbox and compact hidden drafts. An older native test expected ghost-card retention after authoritative CLI replacement; aligned that assertion with the existing backend’s authoritative removal policy, without changing backend behavior. Initial test invocation cwd issue corrected. No Rust/backend changes.

## Completed2026-11-18 (local date)

TypeScript/Vite build passed with existing bundle advisory.59 distinct browser cases passed:18 agent-polish (including four desktop/compact tab/filter/draft geometries and modal read suppression),5 pinned-order,4 host-status,27 ACP,3 native integration and2 real outbox bulk cases. Final relevant logs .local/agent-tab-{build,final-ui,native-final,layout-final,acp-final,integration-final,outbox-tests}.log. The earlier native-final run’s two hidden-draft assertions were corrected by reopening compact chat; all four final layout cases passed. The pinned conflict failure prompted the persistent error fix; final pinned cases passed. Final native integration covers live provider transitions, authoritative removals, explicit reply acknowledgement across restart and phone keyboard proportions. Full ACP covers approval, busy queue, recovery, direct broker restart, Details focus and desktop↔compact relocation across Claude/Codex/Goose.

No new backend features, Rust checks, live agent input, metadata writes, commit/push or deployment. Screenshots use staged frontend against read-only live API data; browser fixtures use disposable state. Existing browser test actors updated to use Filters modal rather than removed inline controls. SSH actor updated but no new real-SSH execution; transport unchanged. git diff --check passed. Reference docs/reference/agent-workspace.md describes final behavior and scope boundaries.
