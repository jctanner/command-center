# Task 0035: Coordinator agent messaging

Owner: CC dev
Claimed: 2026-11-08
State: done

## Goal

Authorize human-requested prompts/replies and bounded coordination follow-ups through the existing guarded outbox, with exact target/conversation identity, durable UUIDs and honest delivery states. No live messages for this instruction update.

## Acceptance criteria

- Consistent coordinator role/skills distinguish explicit sends or scoped coordination from draft-only work and autonomous unrelated messages.
- Exact native message-grant/enqueue/read/check workflow documented, including busy agents, uncertain outcomes, blocked/replaced targets, and no approval/force-submit bypass.
- Verify request examples/helper methods against existing handlers; preserve concurrent launch-skill context-file guidance.

## Validation

Completed 2026-11-08. Added cc-message and the REST messaging playbook; aligned coordinator role, CLAUDE entry point, coordination/launch skills, README and root operating rules. Preserved existing launch context-file guidance.

Static Python validation passed: both JSON examples parse; message UUID/text and fields match the Rust Message handler; check is limited to submitted/uncertain receipts; Python example parses and uses existing helper methods; skill header and retained context guidance checked. `git diff --check` passed. Documentation-only: no backend/frontend rebuild, deployment, live messages, approvals or ticket changes.

Running coordinators should reread their role and cc-message skill before their first authorized send.
