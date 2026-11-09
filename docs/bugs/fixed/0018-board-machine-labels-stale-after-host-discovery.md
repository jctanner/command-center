# Bug 0018: Board machine labels stale after host discovery

State: fixed
Reported: 2026-11-08

Board may load tickets before machine discovery, showing long opaque host IDs in card footers/list rows. setHosts updates metadata without rendering, so labels remain until another refresh. Found during the lighter-card screenshot review. Render the visible inventory when host metadata arrives; do not touch drafts or ticket context. See [Task 0032](../../tasks/done/0032-lighter-board-cards.md).

Resolved by rendering the visible inventory when host metadata arrives. Delayed-host browser fixture passes and live aliases verified after deployment; ticket data/drafts unchanged.
