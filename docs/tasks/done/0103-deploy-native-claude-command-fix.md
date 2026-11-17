# Task0103: Deploy native Claude command receipt/history fix

Owner: CC dev; claimed2026-11-17; State: done.

Human proceed authorizes rollout of current CC-73/75 fix; Goose remains deferred task0102. Deploy tested task0101 backend/frontend with existing listeners/runtime/config/local pane PIDs intact. Verify old CC-73 !pwd receipt resolves as native command from original log position, not resend; command output fields visible in API. No agent restart, new command, ACP translation or Goose work. No commit/push requested in this turn.

## Deployment and live verification

Approved deployment completed2026-11-17T17:10:16Z. Preflight in-flight-operation guards passed. Four configured access paths, initial SSE, complete served OpenAPI/native command contract, staged frontend index and running release binary verified. Exact runtime arguments/environment/configuration hashes and local tmux pane PIDs unchanged. Private receipt .local/reviews/claude-command-deployment.json; backups .local/backups/claude-command-*; log .local/claude-command-deploy.log.

Read-only live API verification: original CC-73 !pwd receipt became command through ordinary reconciliation, retaining original process and log position; seen_message null. Exactly one native command history row at the receipt's command position, literal output available, process association verified and v5 cache version active. No resend, input, manual receipt rewrite, agent restart, new session or ACP command translation. Proof .local/reviews/cc73-native-command-deployed-proof.json. Reload UI once for command labels/plaintext/hint. Existing ACP broker processes unchanged.

No commit/push requested/performed. CC-100 remains pending task0102; no additional Goose reference reads, container runtime changes or testing occurred during this rollout.
