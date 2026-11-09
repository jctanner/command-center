# Task 0031: Ticket Board, list and spacious details

Owner: CC dev
Claimed: 2026-11-08
State: done

## Goal

Simplify Board cards, add a filtered/sorted ticket list with attributes, and replace the small ticket dialog with a nearly full-window detail workspace and previous/next browsing. Preserve optimistic edits, drafts, launch/target safeguards and phone terminal isolation.

## Findings

Read-only live Playwright screenshots confirm 26 tickets: paths and per-card status selects dominate card height. Ticket dialog is 850px wide on a 1440px screen. Private screenshots retained under ignored .local/reviews; no live mutations.

## Acceptance criteria

- [x] Compact intent-focused cards; detailed context in spacious ticket dialog.
- [x] Board/List switch, shared filters/sorting and browser-local view preference; accessible ticket list with attributes.
- [x] Previous/next through filtered tickets; preserve/review dirty drafts and reject stale async responses.
- [x] Desktop/phone screenshots and focused browser regressions, frontend type/build and deployment checks. No live ticket edits or agent launches for validation.

## Validation

- Frontend type/build (`npm --prefix web run build -- --outDir dist-next`) and diff whitespace checks pass. Existing Vite mixed-import/large-chunk warnings remain; no new dependency or backend changes.
- Eight focused Playwright checks pass (20.1s): compact cards, list attributes/filter/sort/view restoration, spacious detail proportions, rendered/source Markdown, dirty confirmation and async navigation race, filtered-out saved ticket navigation, portrait/landscape scroll and no terminal traffic, existing context capture/checklist/conflict/drag behavior, native fixture launch handoff and workspace reload/Back/Forward/draft isolation. Runs use private synthetic databases and fixture agents only. Initial new fixture helper incorrectly called fetch Response.ok as a method; corrected before final verification.
- Reviewed synthetic Board/list/detail desktop and phone screenshots. Visual review caught truncated phone title and narrow filter controls; titles now auto-wrap and mobile filters have a dedicated row. Compact details fill viewport with visible actions and scrollable body. Mobile list retains table headers for accessibility while prioritizing visible number/title/status/machine/date; full attributes remain in detail.
- Read-only live screenshots before/after retained under ignored .local/reviews. At 1440x900, ticket detail grows from 850x700 to 1400x860. Live check observes 26 cards, working List/detail, zero ticket mutation requests, zero terminal sockets and zero page errors.
- Frontend deployed by merge-copying built assets and atomically replacing index, retaining prior hashes/private index backup. Final live health/index/entry JS/CSS bytes match stage. Backend/native agents not restarted; no live ticket edits, launches or messages.
- No Rust/backend changes; Rust suites not rerun. Physical iPhone/keyboard behavior remains a device check; compact Playwright portrait/landscape verified.

## Handoff

Reload CC, open Board and select Board or List; choice is browser-local. Shared search/status filters and updated/number/priority sorting drive Previous/Next. Existing tickets show rendered Markdown by default with Edit Markdown available. Change status in spacious details or drag between lanes; per-card selectors and long paths intentionally removed. Saved tickets leaving filters stay open with Outside filters and disabled browsing controls. Launch and optimistic-revision behavior retained.

Changes uncommitted. Task 0009 and prior Board synchronization work untouched. Next task 0032, bug 0018.
