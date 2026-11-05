# Task 0005: Reliable card color picker saving

Owner: CC dev
Claimed: 2026-11-04
State: done (directory is authoritative)
Completed: 2026-11-04

## Goal

Investigate why a picked card color does not apply, repair native-picker event handling where reproduced, and make staged-versus-saved behavior clear.

## Acceptance criteria

- [x] Reproduce selection/save behavior using isolated fixtures; never change a live user card to test it.
- [x] Color selection works with input/change event sequences and is read correctly on Save.
- [x] Default reset and existing color/pin/name/notes values retain their intended semantics.
- [x] UI clearly explains whether a picked color is staged or saved and retains conflict drafts.
- [x] Build and focused desktop/mobile color tests pass; deploy and record evidence.

## Findings

No live agent card currently has a stored custom color. The editor listens only to input, not change, and saves a separate chosenColor variable rather than reading the control on submit. Investigate a change-only native-picker sequence before assigning the cause. The exact live gesture sequence was not captured; retain the explicit Save workflow and make it clear.

## Validation evidence

Fixture reproduction failed as expected: change-only selection #ff8800 followed by Save card stored an empty string. See [bug 0002](../../bugs/fixed/0002-card-color-change-event-not-saved.md).

After the fix, the same regression passed and also covered saving a current control value without an event, immediate applied card styling after Save, and clearing back to default. All four focused color/pin browser tests passed (13.4s), including conflict drafts, legacy saves/persistence, pin ordering/filters and desktop/mobile editing. TypeScript/Vite build and git diff --check passed. Deployed the frontend and verified its index through HTTPS; no live preferences were changed.

Physical iPhone event behavior remains a user-device check; the change-only and no-event sequences were exercised in browser fixtures.

## Handoff

Reload app, choose a color and press Save card. Both input and change are handled, and Save reads the current control. No remaining implementation work for this task.
