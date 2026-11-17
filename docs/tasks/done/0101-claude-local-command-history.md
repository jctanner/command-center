# Task0101: Native Claude ! command receipts and history

Owner: CC dev; claimed2026-11-17; State: done (deployed in task0103).

Human reports CC-73 !command queue/response issue and comparison CC-75. Read-only evidence: CC-73 native Claude executed !pwd, stored paired bash-input/stdout/stderr user envelopes, but receipt submitted and wrappers shown as user chat. CC-75 ACP submitted literal !pwd chat; Claude chose tool execution and completed its prompt receipt. Recognize only strongly linked native command/result envelope pairs, settle command-specific receipt without resend and render output as literal command output. Preserve literal/ambiguous XML, meta/sidechain/request blobs and exact log/process/position/one-use guards. ACP remains text protocol, add contextual composer explanation for leading !, no shell executor or automatic translation. Tests/docs/OpenAPI; no live input/restart/deploy/commit/push requested for this fix.

## Diagnosis / implementation

CC-73 is native Claude: actual local !pwd execution produced a bash-input user envelope and a linked stdout/stderr user envelope, followed by a genuine model reply. Existing receipt remained submitted because only Pi shell evidence was recognized, and raw wrappers were displayed as user chat. CC-75 is ACP: its !pwd was literal prompt text, completed normally, and the model explicitly chose a tool; that protocol difference is not a failed native command.

Native parser now requires a full root command/output pair with exact session, prompt UUID, direct parent/input UUID, native external CLI provenance and human output turn metadata; duplicate UUIDs, mixed/ambiguous/unpaired XML, meta/sidechains and request blobs cannot establish command evidence. Emits command-specific hash/position under existing process/log inode/post-submit/one-use matching. Leading bang spacing is normalized only for Claude command evidence, never arbitrary human chat. Distinct command receipt/note avoids calling it chat Seen; no resend. Ordinary native commands are not inferred Working chat from those validated envelope rows.

History preserves literal command text/output, labels Command/Command output and uses plaintext pre rendering; global receipt retained, matching inline receipt hides only when the corresponding native input position is rendered. Claude visible-history version bumped to v5 to invalidate cached raw-wrapper pages. ACP remains literal model prompts with contextual leading-! composer explanation; no shell runner or automatic translation/approval added. OpenAPI/reference docs updated.

## Validation

-37 native history Python tests passed, including exact native pair, output safety, wrong prompt/parent, sidechains, mixed/human XML, missing output/duplicate UUID and no synthetic Ready/Working from command output.
-95 Rust library tests and Clippy all-targets -D warnings passed; new Claude command receipt test covers ! spacing, no chat Seen and no evidence reuse. Existing Pi command behavior retained. cargo fmt/diff checks passed.
- Frontend TypeScript/Vite build and release build passed (existing chunk-size advisory).
-34 ACP/mode browser tests passed, including two new native Claude desktop/mobile end-to-end fixtures: original receipt becomes command, no resend, literal hostile-looking output/stderr, no img/HTML execution, no duplicate inline/native !pwd bubble. Four ACP launch/chat cases also verify leading-! explanation; literal ACP text behavior retained.
- Four targeted outbox browser cases pass: three original history-gap/fast-confirmation cases passed initially; the Claude absorbed-steering case only needed its intentional v4→v5 cache assertion updated, then passed on rerun. Six served OpenAPI tests passed.
- Read-only live source-parser check confirms CC-73's original receipt has same process, same log inode, exactly one matching command after baseline and recognized output. No live receipt changed or command repeated. Logs .local/claude-command-{history,rust,clippy,build,web,release,browser-final,outbox-browser,outbox-cache-browser,contract}.log.

## Handoff

No deployment, commit/push, real-agent input/restart or command resend. Backend deployment is needed before CC-73's existing receipt can reconcile through normal polling; no native-agent restart needed. ACP broker code unchanged: composer explanation only, so no ACP broker replacement needed for this fix. After release reload UI for literal command rendering/new cache version. Ambiguous or outside-bounded-history pairs remain literal/unconfirmed rather than guessed.

Human queued CC-100 Goose containers while this was active, then explicitly deferred it. Captured as pending task0102 with all hard constraints and references. Only pre-deferral read-only reference retrieval completed via CC file API; no container/runtime/install/test implementation occurred. Do not move that backlog task to current until resuming after this command fix checkpoint/rollout.

## Subsequent rollout

Human proceed authorized task0103 deployment. Four access paths and original runtime/config/local pane PIDs verified unchanged. CC-73's original !pwd receipt reconciled to command, with one command row and literal saved output in process-linked API history, no resend or agent restart. Source remains uncommitted; Goose task0102 stays pending. Prior staging statements describe implementation checkpoint only.
