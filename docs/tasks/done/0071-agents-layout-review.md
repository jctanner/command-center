# Task 0071: Agents layout screenshot review

Owner: CC dev
Claimed: 2026-11-15
State: done (2026-11-15; recommendations only)

Human requests Playwright screenshots of the live Agents page and improvement suggestions, optionally with Claude's review. Read-only browser: block API writes, no agent inputs, launches, trust answers, notification grants or terminal sockets. Capture laptop/desktop layouts privately under .local/reviews; ask a noninteractive Claude CLI with read-only image access for a second opinion. Record findings and distinguish recommendations from observed defects. No implementation, deployment, commit or push requested.

## Evidence and findings

Read-only Playwright captures at1440×900 and1280×900, selected CC development conversation. Eleven cards present; zero page errors, API writes or terminal sockets, no horizontal document overflow. Native screenshots and Claude's read-only nonpersistent CLI review remain ignored under .local/reviews/agents-layout. No agent prompts, approval/trust actions, source changes or deployments.

Primary recommendation: group consecutive completed tool/thinking events into a compact expandable activity run; individual collapsed rows currently occupy most of the visible conversation. Pending approvals/trust must remain independent/prominent. Simplify repeated tiny token summaries, avoid unknown/unknown noise without guessing capacities, and share selected-conversation counters with its card or make observation age clear (different polling cadences currently show different snapshots). Add quick agent search/jump, improve name legibility and use calmer color accents while preserving pin/unread/selected distinctions. Compact/scoped toolbar labels (global versus selected-agent outbox) are secondary polish.

Claude independently viewed both images and agreed on activity density, metric legibility and card scanning. Its claim that a partially clipped message at the top proves a layout defect is not established: this appears to be the normal history scroll boundary, not a newly confirmed bug. Do not change scrolling based on that inference alone. No implementation or commit requested; present priorities to the human.
