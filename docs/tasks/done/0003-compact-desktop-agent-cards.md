# Task 0003: Compact desktop agent cards

Owner: CC dev
Claimed: 2026-11-04
State: done (directory is authoritative)
Completed: 2026-11-04

## Goal

Reduce laptop agent-card whitespace with a two-row layout: name/status, then machine/harness/project basename. Preserve phone touch layout and explicit attention cues.

## Acceptance criteria

- [x] Ordinary desktop cards are about 64–72px, with optional single-line notes/approval preview.
- [x] Full names/paths and tmux context remain available in tooltips/Details; statuses and unread/approval meaning remain accessible.
- [x] Empty badge rows consume no desktop space, and title/context do not overlap status or overflow.
- [x] Selection, filters, context menus, unread state, drafts and ordering remain unchanged.
- [x] Phone cards retain the existing layout/touch sizing and cannot attach/resize tmux.
- [x] Laptop and phone screenshots, frontend build and focused fixture checks pass.

## Findings

The live 1366×768 screenshot measured ordinary cards at 112px, with attention cards at 132–136px. Machine, status, name and full path each take a row; empty flag containers also leave flex gaps. Desktop rendering can use a two-column grid without changing the existing mobile structure.

## Validation evidence

- Frontend TypeScript/Vite build passed (`npm --prefix web run build -- --outDir dist-next`).
- Release-backed agent browser checks passed across focused runs: unread/read-state behavior, phone chat layout, card editing/conflicts, inline activity, and the new compact-card fixture. Final affected run: 2 passed (card editing and compact layout); the other 3 scenarios passed in the preceding run.
- The new fixture checks 64–72px ordinary cards, one-line preview height, long-title clipping, non-overlapping status, full-context tooltip, accessible attention dot, retained draft/selection/scroll, keyboard menu and the larger phone layout.
- Synthetic laptop/phone screenshots reviewed. Ordinary cards measured 64px, preview cards 78px.
- Deployed frontend without restarting the backend. Live 1366×768 verification measured all 10 observed cards at 64px, with no horizontal viewport overflow; screenshot reviewed.
- `git diff --check` passed. No agent input or tmux mutation was performed for layout verification. Existing bulk-outbox work in the working tree was preserved.

## Handoff

User should Reload app to obtain the desktop layout. Full context is in tooltips/Details; compact view uses a machine/harness/basename line and an accessible attention dot. Phone structure is unchanged. No further work is required for this task.
