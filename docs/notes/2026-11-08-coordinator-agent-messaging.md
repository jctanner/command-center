# Coordinator agent messaging

Task [0035](../tasks/done/0035-coordinator-agent-messaging.md) adds explicit prompts/replies and bounded human-assigned coordination follow-ups through the existing guarded durable outbox. Draft-only work stays draft-only; provider approvals and forced/uncertain retries remain separate.

Request examples and helper methods were statically checked against source; diff whitespace validation passed. No live sends or runtime changes. Running coordinators must reread updated role/skill instructions. Next task number: 0036; next bug number: 0020.
