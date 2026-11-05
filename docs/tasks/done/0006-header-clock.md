# Task 0006: Header date and clock

Owner: CC dev
Claimed: 2026-11-04
State: done
Completed: 2026-11-04

## Goal

Show a compact local date and time at the top right across workspaces, with a readable phone layout.

## Acceptance criteria

- [x] Browser-local date/time, locale formatting, and timezone in a full-date tooltip.
- [x] Minute updates and immediate refresh on returning to the app; no network requests or background hidden-page ticking.
- [x] Desktop/phone header stays bounded; navigation remains usable.
- [x] Frontend build and visual checks; deploy and record results.

## Validation and deployment

TypeScript/Vite build passed. Isolated browser checks at 1440, 1280, 393 and 320px verified browser-local date/time, bounded header without document overflow, and minute/midnight rollover. Phone screenshot inspected. API requests were blocked in the fixture; no live agent actions. Clock uses one minute-aligned timeout while visible, refreshed on focus/visibility changes, without backend requests. Published frontend assets and verified the live HTTPS index matches the build. No backend restart needed.

## Handoff

Reload app to see the date and clock at top right. Compact layouts stack the date above the time; the full date and timezone are available in the tooltip/accessibility label. Existing phone chat mode continues hiding the global header to preserve conversation space.
