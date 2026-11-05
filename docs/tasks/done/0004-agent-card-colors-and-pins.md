# Task 0004: Agent card colors and pinning

Owner: CC dev
Claimed: 2026-11-04
State: done (directory is authoritative)
Completed: 2026-11-04

## Goal

Add a color picker/default reset and pinning to agent cards on desktop and mobile, persisted with existing card metadata.

## Acceptance criteria

- [x] Preserve existing names/notes with an atomic additive SQLite migration; back up the live database before upgrade.
- [x] Accept only an empty/default color or a six-digit hex color, plus a boolean pin. Legacy name/note saves preserve unspecified new preferences.
- [x] Use existing endpoint/process/revision guards; replacement processes do not inherit preferences and conflicts keep editor drafts.
- [x] Pinned cards sort first, with existing attention ordering within pinned/unpinned groups and filters still respected. Custom accents do not override status/selection/attention indicators.
- [x] Desktop menu offers Pin/Unpin; desktop/mobile card editor offers picker, default reset and pin checkbox.
- [x] Migration, validation, persistence, stale edits, ordering and compact/mobile layout are verified without agent input or terminal resize.

## Scope and decisions

These are explicit card preferences scoped like names/notes, not agent configuration or tmux renames. Preferences survive backend/browser restart for the same process; a replaced CLI starts with defaults. Pins do not bypass filters or change unread state. Keep the compact card height.

## Files likely involved

src/board.rs, src/agent_cards.rs, web/src/agent-card-editor.ts, web/src/queue.ts, web/src/style.css, focused tests and feature reference.

## Validation evidence

- Rust tests passed: 36 library, 2 binary, 2 tmux integration; includes migration of a legacy version-1 card with retained name/notes/revision, defaults and reopen persistence.
- Formatting, Clippy with warnings denied, release backend build and TypeScript/Vite build passed.
- Six focused agent browser checks passed: legacy metadata/restart behavior, existing editor conflicts, compact card layout, color/pin validation and replacement isolation, shared desktop/mobile editing, and pinned-group attention/filter behavior.
- Two ticket-launch regressions passed, including named-card initialization and later edits/replacement isolation.
- Reviewed synthetic laptop/phone screenshots. Colored pinned cards stay 64px; status/attention colors remain unchanged, mobile controls fit, and fixture terminal processes/dimensions/output are unchanged.
- Before deployment, created a mode-0600 SQLite backup outside the repository in the private local CC state directory. Deployed the additive version-2 migration and frontend, verified schema/HTTPS health, and compared existing metadata rows against the backup.
- No live card color/pin preferences were changed during verification. Physical iPhone native picker behavior remains a user-device check; mobile browser layout was tested.

## Handoff

Reload app. Desktop card menu offers Pin/Unpin; Edit card (including phone Details) offers the color picker, default reset and pin checkbox. Preferences remain process-scoped. No remaining implementation work for this task; no live Board ticket statuses changed.
