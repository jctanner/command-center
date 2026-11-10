# Bug 0025: Codex root status rolls outside the small tail

State: fixed

A long native Codex turn emits more than 512 KiB after task_started. The small status scan sees recent item_completed events but has no root anchor, producing Unknown despite an intact process link and fresh root-scoped progress. Use bounded adaptive look-back, preserve parent/child identity and freshness checks, and fail honestly when no anchor is available within the cap. Task 0044.

Fixed by bounded adaptive root look-back in [task 0044](../../tasks/done/0044-codex-status-root-lookback.md), retaining same-root progress and failure/freshness guards. Five new regression tests, existing history/status suites and live queue/detail verification pass. Deployed backend only; original native process/conversation preserved.
