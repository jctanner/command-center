# Task 0073: CC-75 outbox synchronization

Owner: CC dev
Claimed: 2026-11-15
State: done (approved backend deployment and real receipt reconciliation verified)

Human reports an outbox synchronization issue on CC-75. Inspect the exact process/conversation, durable receipt state and native history read-only. No agent sends, resends, cancellations, archives, trust decisions or restarts without separate authorization. Retain metadata/fingerprints only; do not copy transcripts or message bodies into evidence. Diagnose first and implement a guarded regression fix if warranted. Backend deployment/restart requires explicit human approval.

## Diagnosis and implementation

Metadata-only proof found four ordinary CC-75 receipts Seen and the latest still Submitted on the same process/conversation. The latest exact prompt exists as native remove(reason=absorbed_mid_turn) plus a queued_command attachment with matching command/delivery UUIDs, origin.kind=human, humanTurn=true, commandMode=prompt and cli/external envelope. RenderedRole is system; an API request blob includes its model context. Neither is a normal user message, so old history skipped it.

Implemented a narrow consumed-prompt projection, never rendered/system/request text. Same-session identity, parent/record/source/delivery UUID validity, exact prompt, prior removal order, main-chain human envelope and duplicate/conflict guards required. It produces a normal user history row/digest at the original attachment byte offset, allowing existing receipt reconciliation to mark Seen with unchanged native process/log inode/baseline/one-use rules. Claude visible prefix v4 resets old display pages; native reply/read cursors remain intact. [Bug0038](../../bugs/fixed/0038-claude-absorbed-input-unconfirmed.md).

Actual read-only verification using staged helper against the existing native log: original process and log inode match, exact prompt occurs once at native offset5187429 after the receipt baseline. No send/resend/receipt rewrite/agent restart. Live receipt still Submitted because the running backend embeds the old helper.

## Validation

- New Python provenance/history tests5 passed; existing history34, outbox7, busy-input7 and activity5 passed.
- Rust88, all-target Clippy -D warnings and release build passed. No frontend/source bundle changes needed for this fix.
- New isolated fake-Claude Playwright integration passed: busy-time submission, consumed attachment yields Seen at exact offset, no further terminal input, one user bubble, no rendered system leakage, v3 cache resets to v4. No real provider launched.
- Metadata-only evidence under ignored .local/reviews/cc75-outbox; no raw conversation snapshot retained. An initial attempt to save a full diagnostic snapshot was rejected by approval review and replaced by metadata-only inspection.

Backend fix is staged and ready. Deployment requires an explicit restart request; no backend deployment, live outbox mutation, commit or push performed. Applying it should let normal observation reconcile the existing receipt without sending input again.


Prepared .local/deploy-claude-absorbed-input.py, syntax-checked only; retains existing runtime/env/listeners, backs up previous binary/state/assets, preflights active outbox/question/trust/export actions and checks health/SSE/config/pane PID identity. Human approval requested asynchronously for backend deployment; not yet received. This is a distinct release from the earlier frontend-only deployment. Do not execute until explicitly approved. After approval, deploy then inspect the same original receipt ID for automatic Seen reconciliation and a single native user row—never resubmit it.


## Approved deployment and outcome

Human approved the backend deployment. Executed .local/deploy-claude-absorbed-input.py successfully: four configured access paths and existing SSE/contracts healthy, running binary hash matches release, configuration hashes and canonical tmux pane/PID snapshots unchanged. Existing runtime/environment/listeners preserved and private binary/database/assets backups retained. No native agent restart, resend or manual receipt rewrite.

Read-only live API verifies the original CC-75 receipt changed automatically to Seen at native offset5187429, with the original process and conversation unchanged and exactly one projected user message. Visible history reports claude-visible-v4. Live compact Chromium verifies one native Seen message, no pending duplicate bubble, no page errors or terminal sockets; all API writes were blocked. Deployment approval gate resolved. No commit or push requested/performed.
