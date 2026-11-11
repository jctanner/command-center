# Task 0058: Tickets navigation

Owner: CC dev
Claimed: 2026-11-11
State: done

Rename top-level Board to Tickets and order workspaces Agents, Tmux, Files, Tickets, Whiteboard, Slack, Jira, Email. Preserve workspace identities/routes and the board/list view labels within Tickets. Validate build and served navigation; static asset publication needs no backend restart.

Validation: frontend TypeScript/Vite build passed. Published static assets with index backup and atomic index replacement; no backend restart. Read-only live Chromium check verified all eight labels in requested DOM order and Tickets still opens #/board. Existing board/list subview labels retained. No ticket writes, commit or push.
