---
name: cc-coordinate
description: Investigate overlap, draft ownership proposals, and send human-authorized coordination messages through cc-message.
---

Use an evidence-backed inventory or overlap review first. Draft one addressed prompt per intended agent, including machine ID, tmux target, process instance and conversation ID where verified. State the relevant goal, evidence, proposed responsibility, machine-qualified files, dependencies and acceptance criteria. Prefer file references and brief excerpts over copied conversations. Never assume the receiving agent can read the Board, the CC API, this workspace or files on another machine. Put everything it needs (ticket text, checklist, acceptance criteria, facts, ground rules) directly into the message as a self-contained Markdown brief, as described in `cc-launch`. Keep it within the 12,000-byte message limit, and say the Board isn't reachable from the agent's machine.

Separate observations from proposed instructions. Explain what would change and what still needs confirmation. Never assume one agent's instructions authorize controlling another. If identity or history association is uncertain, ask the human to resolve it before proposing delivery to that target.

For draft/review-only requests, output drafts without sending. When the human explicitly asks to send them or assigns a scoped coordination task, use cc-message to send faithful prompts and relevant replies to the named agents through the durable outbox. That task supplies consent for ordinary follow-ups within scope; do not ask again generically. This does not authorize tool approvals, unrelated messages, unattended broadcasts, source edits, restarts/closures or marking work complete. Ticket edits and new launches use their separate skills only when requested. Never use a shell/terminal workaround.

If the human explicitly requests new agents as part of coordination, switch to `cc-launch` for those specific launches. This drafting skill alone does not authorize launching or sending anything.
