# Task 0042: Pi command-mode message receipts

Owner: CC dev
Claimed: 2026-11-09
State: done

Diagnose a submitted pi message consumed as native bang-shell input. Report exact process/log/baseline-bound command evidence separately from chat Seen; never replay it. Prevent future ordinary chat from silently invoking pi shell mode. Any corrected new send requires explicit human approval.

## Diagnosis and implementation

The reported input began with a merge-request exclamation reference. Pi consumed it as bang-shell input and persisted a failed bashExecution record at the original receipt's exact pre-send byte offset. Same native process/conversation/device/inode stayed valid; no corresponding user-chat record existed. It was not an undelivered CC queue entry.

Collect only active-branch typed pi bashExecution metadata, bounded by existing history limits, with explicit boolean excludeFromContext to distinguish ! from !!. Expose digest/position evidence only, not shell output. Existing receipt matching enforces same log identity, post-baseline position and one-use accounting. Set terminal outcome command with separate command_message position, leaving chat seen_message null. Archive remains explicit; no Submit now replay capability for this outcome.

Reject future ordinary pi chat with leading bang (including JavaScript-trimmed BOM/whitespace) before buffer/input IO. Browser keeps the draft and explains using a conversational FYI: prefix. API callers receive an explicit blocked receipt if they bypass the client guard. No silent rewriting, native command execution, retries or new send implied by this fix.

## Validation

- Three new Python tests pass: active-branch command evidence only, !/!! distinction/ambiguous metadata, leading-bang/BOM rejection before any tmux IO. Seven busy-input regressions pass.
- 46 Rust library tests pass, including persisted command classification with null chat Seen and distinct one-use native positions. Initial sandbox run had existing socket-denial failures; allowed loopback rerun passes.
- Four focused Playwright cases pass in 37.6s: command-outcome UI and draft/zero-send guard, busy native input, uncertainty no-replay and continuous message handoff.
- Formatting, Clippy all-targets -D warnings, debug/release builds, frontend TypeScript/Vite staging build and diff whitespace checks pass. Existing frontend bundling warnings remain.
- Read-only patched observer against the actual native process confirms exactly one matching command digest after the original baseline in the same file/inode. No input sent during diagnosis.

## Deployment and approved recovery

Backend/frontend deployed with exact prior argv/environment/listeners. Four access paths healthy; config hashes and canonical pane/PID snapshot unchanged. The original receipt now reports command, with command_message equal to its exact baseline offset, seen_message null and original UUID/text/target/process/conversation preserved. No native agent restart, resend, archive/release, tool approval or Board mutation.

After explicit human approval, sent the exact proposed FYI:-prefixed correction as one separate durable intent through a fresh process/conversation-bound grant. Persisted owner-only intent metadata before the single POST; observed the new receipt Seen in the original process-linked conversation. Original command receipt stayed unchanged; no archive/release, native restart, approval action or retry. Recovery is complete. Private diagnostic/send metadata and deployment evidence remain ignored under .local. Next task 0043; next bug 0024.
