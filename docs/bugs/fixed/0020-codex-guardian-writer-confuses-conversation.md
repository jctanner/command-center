# Bug 0020: Codex guardian writer confuses conversation association

State: fixed

A CC-launched Codex using automatic approval review owns writer locks and open rollout files for both the main thread and its guardian reviewer. Discovery treated the explicitly provider-marked subagent as another linked user conversation. Multiple links prevent verified Ready and leave previously authorized input queued.

Observed via process-owned locks and provider session metadata, not title/recency guesses. Fix must exclude explicit guardian/subagent histories while preserving genuine multiple root ambiguity, existing receipt UUID/target/conversation and parent activity. See task 0038. No replay/force-submit allowed.

Fixed by excluding explicit guardian/subagent metadata before user conversation association. Three targeted Python tests and four outbox integration checks pass; old behavior fails regression coverage. Deployed and observed original affected receipt Seen with unchanged identity/text and agent Working. Task [0038](../../tasks/done/0038-launched-agent-queued-input.md).
