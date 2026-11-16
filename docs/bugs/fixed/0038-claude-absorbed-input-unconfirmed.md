# Bug 0038: Claude absorbed mid-turn input remains Submitted

Found: 2026-11-15, task0073 / human CC-75 report.
State: fixed and deployed with human approval

Metadata-only inspection: latest CC-75 receipt is Submitted on the same verified process/conversation. Native log has matching queue-operation enqueue, remove(reason=absorbed_mid_turn, commandUuid/deliveryId), then a human-origin queued_command attachment with the exact prompt, matching source/delivery UUIDs, humanTurn=true, cli/external envelope and same session. No ordinary user message represents it, so the existing history/receipt parser misses delivery and the outbox bubble remains unconfirmed. Four earlier ordinary user receipts are Seen normally.

Fix narrowly recognizes this consumed human prompt for history and receipt evidence, excluding arbitrary/system attachments, queue-only/remove-only events, sidechains, mismatched identities and request blobs. Preserve native offsets, inode/baseline/process guards, one-use matching and no replay. Never resend the real receipt or rewrite native logs. Native message contents are not copied into this ledger or evidence files.


Staged fix: only a validated consumed same-session human queued-command pair becomes a user row/digest at the original attachment offset. No system/request blobs, queue-only or cancelled inputs are projected; native process/inode/baseline and one-use matching remain unchanged. Claude visible v4 invalidates stale display pages. Tests: Python5 new + history34/outbox7/busy7/activity5; Rust88/Clippy/release build; fake-Claude end-to-end receipt/UI/cache test passed with no resend. Read-only live proof confirms the exact original receipt can match once after its baseline. No production receipt altered; live status remains Submitted pending authorized deployment.


Approved release verified: same original receipt automatically Seen at its native attachment offset, exactly one user history row, original process/conversation retained. Compact UI shows Seen without a pending duplicate. Four access paths healthy, tmux pane PIDs/configuration unchanged. No resend.
