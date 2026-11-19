# Task0159: Wider context meter

Claimed2026-11-18 by CC-dev. Human requests more than three quarters for the context bar. Replace fixed ratio with remaining-width meter and content-sized runtime; preserve card dimensions and responsive layout.

## Completed2026-11-18

Context row uses minmax(0,1fr) auto with6px gap: runtime takes its text width, meter uses the rest. Updated reference. Frontend build and two existing runtime geometry browser cases1440/393 passed, covering formatting and unchanged card dimensions. git diff --check passed. Logs .local/wider-context-meter-{build,tests}.log. CSS only; no backend changes, commit or deployment.
