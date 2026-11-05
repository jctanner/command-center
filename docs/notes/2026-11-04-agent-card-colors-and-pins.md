# 2026-11-04: Agent card colors and pins

Agent: CC dev

## Completed

[Task 0004](../tasks/done/0004-agent-card-colors-and-pins.md) adds a persistent color picker/default reset and pin checkbox, plus desktop Pin/Unpin. Pinned-first ordering respects filters and attention priority inside each group. Colors use a subtle tint/right accent; provider status and attention/selection cues retain their meaning. Revision guards, legacy saves and process isolation are preserved.

## Verification and deployment

Rust migration/persistence and other suites passed (36 library / 2 binary / 2 integration), as did formatting, Clippy and builds. Six focused card browser scenarios and two named-ticket launch regressions passed. Synthetic screenshots checked desktop/mobile UI, unchanged 64px card height, conflict drafts and no phone terminal attachment/resize.

A private mode-0600 SQLite backup was taken outside Git before deploying schema version 2. Live schema and HTTPS health verified; existing card metadata compared against the backup. No live card settings or Board statuses were changed. Never automatically restore receipt backups because queued/submitted delivery evidence must be reviewed. Physical iPhone picker behavior is not hardware-tested.

## Handoff

Reload app to obtain the controls. Next repository task number: 0005. Card preferences survive backend/browser restart for the same process; replacement CLI processes start with defaults.
