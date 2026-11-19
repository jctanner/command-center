# Task0155: Keep partial scans out of machine availability

Claimed2026-11-18 by CC-dev. Human requests no navbar warning for discovery limitations alone. Only actual host errors belong in Machine availability; remove misleading hardcoded32-pane diagnosis. Preserve backend limited metadata and disconnected-agent safeguards. Validate desktop/mobile host-error browser cases and build.

## Completed2026-11-18

Navbar machine availability now includes only hosts with errors. Partial discovery alone is quiet, including after another machine recovers. Removed hardcoded32-agent explanation; errors retain literal safe rendering, SSH key guidance and existing modal. Backend limited metadata and agent safety/reconciliation unchanged. Updated workspace reference.

Validation: frontend TypeScript/Vite build passed; four queue-host-errors browser cases passed at1440x900,1366x768,393x852,852x393. Fixtures retain a limited-only host through recovery: exactly one real host error counted initially, partial host absent from modal, warning disappears once error clears even though partial scan persists. No write or terminal WebSocket traffic. git diff --check passed. Logs .local/quiet-partial-scans-{build,tests}.log. No backend changes, live machine edits, commit or deployment.
