# Task0139: Theme-aware pinned card indicators

Claimed2026-11-18 by CC-dev. Human requests removing duplicate thumbtack/grip and matching pin color to theme. Manual draggable cards retain only six-dot themed grip. Activity-sorted/non-draggable pinned cards retain a monochrome CSS-mask pin using theme color. No backend or interaction changes. Build/verify existing pinned behavior; no commit/deploy requested.

## Completed2026-11-18 (local date)

CSS removes the emoji thumbtack from cards with a drag grip. Six-dot grip uses existing theme-muted color. Pinned cards without a grip (activity sorting or unavailable ordering) use a tiny monochrome CSS-mask pin in theme-muted color, preserving pin identification without colored emoji. No backend or behavior changes.

TypeScript/Vite build passed (existing bundle advisory);5 existing pinned-order browser cases passed for desktop/touch dragging, settings mode changes, persistence, cross-client conflicts and filtered order. Phone screenshot inspected: only grip remains on draggable cards. git diff --check passed. Logs .local/themed-pins-{build,tests}.log. No new tests added for this low-impact CSS change. No commit, push or deployment.
