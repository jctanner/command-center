# Task0100: Release ACP usage and upgrade coordinator

Owner: CC dev; claimed2026-11-17; State: done.

Human explicitly requested commit/push/deploy followed by cc-coordinator upgrade. Commit task0099, deploy tested release with all listeners/runtime/config/local pane PIDs preserved, then use separately authorized guarded ACP→native→ACP exact-conversation handoffs for only coordinator. Verify old/new broker identities, original conversation, card metadata, queue capability and new usage reader. Do not send chat or /usage prompt to manufacture metrics. Unknown usage remains honest until an event arrives. No other agent restart or automatic uncertain replay; status recovery read-only. Record release and operational receipts privately, complete ledger and push evidence.

## Release and upgrade result

Implementation d0dd999 committed/pushed to origin/main over SSH. Approved backend deployment completed2026-11-17T16:12:45Z. Preflight in-flight guards passed. All four configured access paths, SSE, full served OpenAPI/usage contract, frontend index and running release binary verified. Complete runtime arguments/environment, configuration hashes and local tmux pane PID inventory preserved during deployment. Backup .local/backups/acp-usage-*; receipt .local/reviews/acp-usage-deployment.json; log .local/acp-usage-deploy.log.

Then performed only the separately authorized coordinator ACP→native→ACP round trip through existing guarded preparation/one-use POST/read-only status APIs. Settled screen before each preparation; both receipts complete, no retry/recovery exception needed. Exact original native conversation and machine/session/window/pane verified after each leg; card name/notes/color/pin and other local pane PIDs unchanged. Private journal .local/reviews/coordinator-usage-upgrade.json. New broker.py SHA-256 matches released source and snapshot exposes usage/token_metrics fields, Ready state, prompt_queue true and zero queued prompts.

No usage event had arrived at verification, so reported metrics remain honestly null until normal adapter activity. No chat message, automatic /usage command, approval/trust answer, new/forked conversation, package installation or other agent restart performed. Real coordinator usage-event content remains untested without an ordinary turn; synthetic event pipeline checks already passed. Deployment/upgrade evidence is committed and pushed separately; no second service restart needed for records.
