# Task 0079: Agents toolbar action order

Owner: CC dev
Claimed: 2026-11-16
State: done (deployed)

Human requested Start agent before All outboxes. Swap their DOM order, retaining keyboard order and existing behaviors. Build and publish this small frontend correction without a backend restart.

Swapped the two DOM children, preserving focus/tab order. TypeScript/Vite staged build passed. Frontend-only publication verified2026-11-17T01:17:26Z: four access paths/index hashes healthy, backend/config/native pane PIDs unchanged. Live compact browser verified Start agent precedes All outboxes, native default and ACP handoff still work, zero page errors/writes/terminal sockets. No backend restart, agent input, commit or push. Private metadata .local/reviews/agents-action-order-publish.json and agents-action-order-live.json.
