# Task 0032: Lighter Board cards

Owner: CC dev
Claimed: 2026-11-08
State: done

## Goal

Lift Board card backgrounds above the lane surface and keep secondary labels readable across themes. Small presentation refinement; retain existing layout and ticket behavior.

## Validation

- Frontend type/build and diff whitespace checks pass. Card fill mixes the theme raised surface with 12% white; secondary labels mix text/muted palette for contrast. No new dependencies or geometry changes.
- Read-only Playwright dark/light review: Command Center title/metadata contrast 8.33:1 / 7.27:1; Flexoki Light 16.94:1 / 14.39:1. Private screenshots under .local/reviews reviewed for the default dark palette. No live ticket mutations.
- Two focused browser regressions pass (3.1s): existing compact cards/list/detail behavior and delayed host discovery resolving IDs to display names. No live agents launched or restarted.
- Frontend deployed atomically with old assets/index backup retained. Served index matches stage; live computed card color and resolved aliases verified, with zero ticket writes. Backend unchanged.
- No Rust changes; no Rust suites or new color-only unit tests needed. Previous Task 0031 behavior checks remain the broader baseline.

## Discovery

Live screenshot exposed stale machine-ID labels before asynchronous host discovery. Include a visible-only rerender on setHosts and a delayed-discovery regression; this updates labels without changing ticket context/drafts.

## Handoff

Reload CC for lighter cards. Label discovery rerenders only the visible inventory and leaves drafts/context intact. Prior uncommitted Board/List changes preserved. Next task 0033, bug 0019.
