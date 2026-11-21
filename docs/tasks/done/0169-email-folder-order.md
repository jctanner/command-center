# Task0169: Logical email folder ordering

Claimed2026-11-21 by CC-dev. Human reports arbitrary email folder order. Keep Inbox/All mail pinned, naturally alphabetize remaining labels case-insensitively. Preserve selected label across refresh and mailbox read-only behavior. Validate frontend and responsive fixture browsing. Prior uncommitted task0168 cancellation records are unrelated and retained.

## Completed2026-11-21

Email dropdown pins Inbox/All mail as before, then sorts remaining labels with locale-aware case-insensitive natural comparison and deterministic name/ID tie breaks. Selection stays keyed by label ID; no mailbox API or data changes.

Validation: frontend TypeScript/Vite build passed; two synthetic-email Playwright cases1440/393 passed, checking alpha/Beta ordering, Project2 before10 and selection/order preservation after reversed provider refresh. No horizontal overflow. git diff --check passed. Logs .local/email-folder-order-{build,tests}.log. No live mail mutation, commit or deployment.
