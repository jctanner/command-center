# Claude clarification attention staged — 2026-11-11

Task 0056/bug 0028: missing coordinator attention is a native AskUserQuestion dialog, not an allow/deny tool permission. Verified registry waiting was unsupported and fallback permission wording missed it. Captured evidence stays private; no question answered or agent launched.

Staged source/release/frontend provide read-only question attention/context and native waiting fallback with input labels. No new approval keys or choice actions; messages remain blocked and drafts retained. Four Python question, 34 history/status/approval, seven busy-input, 62 Rust and four focused browser tests pass. Clippy/format/release/type/build/contract/diff checks pass. Saved-prompt replay confirms recognition without approval capabilities.

Not deployed or committed. Prepared /tmp/cc-deploy-question-attention.py is syntax-checked only; requires the requested brief service-restart check-in. Preserve exact listeners and native pane/PIDs; after deployment inspect the same pending target read-only, never recreate a question or send input to test. Whiteboard real-harness checks remain separately pending task 0054.
