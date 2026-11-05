# Bug 0002: Native color-picker change event is not saved

Reported: 2026-11-04
Impact: a selected color can be lost even after the user saves the card.

## Reproduction

In an isolated agent card, open the editor with the default color, set the native color control to #ff8800, dispatch change without input, and press Save card. The new regression in web/tests/agents.spec.ts reproduced this against the deployed frontend build.

## Expected / actual

Expected: backend stores #ff8800 and the card receives its color styling. Actual before fix: backend stores an empty string. The editor listened only to input and submitted a separate chosenColor value. The live user's exact picker event sequence is not proven; no live card currently has a saved custom color.

## Resolution and verification

Fixed 2026-11-04: handle both input/change, read the current control on Save without breaking explicit default reset, and label the Save requirement. The original fixture failed with an empty saved color before the fix and now passes, including no-event current-value fallback, applied card styling and reset. Four focused color/pin browser checks and the frontend build passed; deployed frontend verified over HTTPS.

## Related task

[Task 0005](../../tasks/done/0005-reliable-card-color-picker.md)
