# Task 0081: ACP directory field layout

Owner: CC dev
Claimed: 2026-11-16
State: done (deployed)

Human reports ACP directory input truncation and suboptimal layout. Preserve the current working-tree header/actions/grid refinements, give Directory a full-width row, keep Machine/project above and actions below, retain compact single-column layout. Validate rendered geometry and broker behavior, then frontend-only publication.

## Implementation and evidence

Directory spans a dedicated full-width row; Machine/project sit above and actions below. Selects no longer inherit the global200px cap; path uses a monospace face. Compact form stays single-column. Empty setup uses fit-content height; selecting a conversation retains the chat-sized dialog.

Observed shared layout files change/revert during implementation; asked human about concurrent edits and moved the correction into new scoped acp-layout.css imported by main.ts, avoiding dependence on alternate header/actions markup. No response needed to complete the independent stylesheet fix. The first geometry check caught the reverted base style (225px input); isolated selectors fixed it. A screenshot then exposed native modal auto-height stretching; fit-content plus a height assertion fixed that.

TypeScript/Vite build and three desktop/mobile/handoff browser tests pass. Assertions check directory spans the form and sits beneath machine controls; empty desktop setup is under600px tall. Synthetic screenshot inspected. Final frontend publication2026-11-17T01:33:09Z verified four paths/index hashes and unchanged backend/config/tmux PIDs. Live browser confirms full-width directory, compact empty state, native/ACP entry, zero errors/API writes/terminal sockets. No backend restart, agent input, commit or push. Private verification .local/reviews/acp-directory-layout-publish.json and acp-directory-layout-live.json. Human subsequently reported their own ACP connection test worked fine.
