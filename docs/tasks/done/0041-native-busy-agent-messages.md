# Task 0041: Native busy-agent message delivery

Owner: CC dev
Claimed: 2026-11-09
State: done

Let explicit human input reach verified Working native agents through their ordinary paste/Enter queue while retaining durable intent receipts, exact process/conversation identity, approval/dialog guards and uncertainty no-replay. Distinguish terminal submission from native-history Seen. Cover streaming output, sequential backlog, boundary races and current Ready/unknown behavior. No invented provider acceptance.

## Findings and implementation

The worker required verified Ready and held every later intent behind earlier Submitted receipts until native history confirmed them. That prevented messages reaching a long-running native CLI. Installed pi source confirms regular Enter during streaming calls prompt with streamingBehavior=steer; Alt+Enter follow-up behavior is not changed or simulated.

- Dispatch explicit saved intents to verified Ready or Working provider state. Keep endpoint/process/unique conversation guards, mode checks and native approval/selection-dialog exclusion. No interrupt keys or provider permission responses.
- Pi Working requires a recognized empty native editor, width/cwd footer fingerprint and fresh bridge evidence. Spinner, usage and tool output may change without making input stale. Nonempty/unfamiliar editors remain queued.
- Busy Codex/Claude may refresh an observation after SSH output advances, but still require a second exact screen fingerprint before paste. Revalidate process/conversation/state/dialogs again immediately before input.
- Only explicit known pre-paste not-sent responses defer the same durable intent for a fresh boundary. Failures after paste/Enter or lost transport responses remain uncertain and never replay.
- Definite anchored Submitted receipts allow later intents in submission order before Seen, including before lazy Pi log creation. Blocked/uncertain and legacy unanchored Submitted receipts remain barriers. Identical intents still require distinct unused post-baseline native history positions.
- Keep Submitted versus Seen honest; native queues may defer persisting user messages. Updated frontend feedback and coordinator/API instructions. Public message request shape unchanged.

## Validation

- Seven new busy-input Python checks and 62 existing agent Python tests pass. Covers three providers, changing pi spinner, drafts/dialogs, changed identity/conversation, active unknown/approval, pre-paste deferral and post-paste uncertainty. Existing SQLite ResourceWarnings remain.
- 45 Rust library tests, formatting, Clippy all-targets -D warnings, debug/release builds and frontend TypeScript/Vite build pass. New Rust test preserves uncertainty/legacy barriers while permitting anchored submissions. Existing frontend bundling warnings remain.
- Complete 18-test outbox Playwright suite passes in 1.9m. A strengthened Pi pre-log pipeline case separately passes in 15.7s. After the final busy-output refresh adjustment, busy/guardian/uncertainty cases pass in 21.8s. Initial run accidentally used the previous release binary; interrupted and reran against an explicitly rebuilt debug backend.
- Read-only observation of the actual reported pi process validates Working, process-linked log and the empty editor guard before deployment. git diff --check passes.

## Deployment and live outcome

Deployed release backend/frontend with exact existing listener argv/environment; four access paths healthy and configuration hashes unchanged. The deployment’s full pane inventory string comparison changed and its preflight pane list was not retained, so do not claim all non-agent panes were unchanged or infer a cause. Follow-up comparison showed every previously observed agent retained its process identity; no native agents were restarted. No repeat deployment was performed to hide this warning.

The original two reported queued intents progressed through the normal worker, retaining UUID/text/target/process/conversation. One was explicitly observed Submitted while Working; both subsequently became Seen in the native conversation. No new live test messages, manual resends, force-submit, approval actions, receipt archives/releases or live Board writes. Private evidence remains in ignored .local/reviews and deployment backup/log under .local. Reload clients for updated feedback; busy delivery is backend-owned.
