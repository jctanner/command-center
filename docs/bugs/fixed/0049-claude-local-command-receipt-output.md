# Bug0049: Native Claude local-command receipt/output mismatch

Reported2026-11-17 on CC-73 !pwd. Native execution succeeded, but bash-input/stdout/stderr user-envelope records did not map to shell receipt evidence, so outbox remained submitted and XML appeared as user chat. CC-75 differs because it is ACP and !pwd is literal model input, not TUI shell mode. Fix recognizes only linked native envelope pairs, settles command-specific receipts under existing process/log/position/one-use guards, renders labeled literal output and avoids duplicate inline/native bubbles; preserves ambiguous XML. ACP composer explains text semantics, without adding direct execution.37 history/95 Rust/34 browser plus4 outbox/6 contract checks pass. Source fixed, not deployed; original live CC-73 receipt untouched. See task0101.

Deployed with human approval in task0103; original CC-73 receipt now command and one command row/output verified through read-only live API. No resend or agent restart.
