# Task 0078: Restore Agents toolbar layout

Owner: CC dev
Claimed: 2026-11-16
State: done (frontend correction deployed)

Human reports the ACP agents button disrupted the existing toolbar. Remove the standalone control and keep explicit ACP entry via Start agent → Connection protocol. Preserve the experimental catalog and native default, validate desktop/mobile and publish the frontend correction within the approved ACP release without another backend restart.

Removed the standalone ACP button and restored the exact prior heading/control order. Broker dialog initialization remains passive; launcher protocol selection is the sole entry, including existing-session discovery. Updated browser reopen paths and reference docs.

Staged TypeScript/Vite build and three ACP desktop/mobile/handoff Playwright tests pass. Added absence assertion for standalone button. Frontend-only publication at 2026-11-17T01:11:32Z verified four access paths/index hashes and unchanged backend/config/tmux pane PIDs. Live compact Chromium: native default, ACP launcher dialog and prepare gate work, zero page errors/writes/terminal sockets. No backend restart, agent launch/input, commit or push. Private evidence acp-toolbar-publish.json and acp-toolbar-live-browser.json under .local/reviews.
