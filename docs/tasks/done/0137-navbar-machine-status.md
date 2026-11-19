# Task0137: Navbar machine availability modal

Claimed2026-11-18 by CC-dev. Human asks to screenshot desktop Agents and move unavailable/limited machine status from bottom disclosure to navbar-right modal. Live read-only Playwright screenshots confirm an implicit third grid row: body ends850/718 at900/768 heights; warning below. Remove row, preserve sanitized diagnostics/SSH identity help and fresh recovery, keyboard/touch access, modal focus and compact terminal isolation. No deployment or commit requested.

## Completed2026-11-18 (local date)

Machine warning count now lives in navbar-right while Agents is visible. It replaces only the healthy Connected indicator, preserving non-online/backend errors. Clicking opens a native centered dialog with checked-at time, sanitized per-machine diagnostics, scan limits and existing SSH identity/dual-boot guidance. Close/Escape restores trigger focus; after recovery the modal stays open with All machines available and Close returns to Start agent. Leaving Agents hides the warning and closes the dialog. Unchanged diagnostics are not rebuilt during polling, preserving reading/scroll state.

Removed bottom details node and styles, eliminating its implicit grid row. Live desktop measurements:1440x900 body724→758px (bottom850→884);1366x768 body592→626px (bottom718→752). Gain34px, no navbar/page horizontal overflow. Before/after/modals captured with Playwright using actual live GET data and staged assets; zero mutation attempts and zero browser errors. Screenshots/measurements under ignored .local/reviews/agents-host-space-{before,after}-*.png/.json and agents-machine-modal-*.png. Earlier after capture caught transient history loading; final capture waits for messages.

Validation: TypeScript/Vite build passed with existing bundle advisory;4 focused host-status cases passed at1440x900,1366x768,393x852 and852x393. Covered initial hidden dialog, keyboard open/close/focus, unchanged body geometry, long diagnostics/XSS text, limited hosts, recovery while open, no writes or terminal sockets.18 agent-polish/pinned-order regressions passed.22 browser cases total. git diff --check passed. No Rust/backend changes or checks required. Logs .local/navbar-machine-status-{build,tests,regressions}.log.

No commit/push/deployment, live agent input, backend restart or settings writes. Production remains task0136 until a requested frontend release.
