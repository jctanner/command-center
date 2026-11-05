# 2026-11-04: Native card color-picker save fix

Agent: CC dev

## Completed

[Task 0005](../tasks/done/0005-reliable-card-color-picker.md) fixes [bug 0002](../bugs/fixed/0002-card-color-change-event-not-saved.md). A change-only native picker event previously saved an empty color even after Save card. The editor now handles input/change and reads the actual control on submission while respecting Use default color. The form explains that Save card applies changes.

## Validation and deployment

The fixture failed before the fix and passed afterward, including a no-event value fallback, applied card styling and explicit default reset. Four focused color/pin tests and the frontend build passed. Frontend deployed and HTTPS index verified. No live card settings, backend schema or Board ticket states were changed by this fix. Actual phone-native events still need the user's device confirmation.

## Handoff

Reload app, choose the color and press Save card. Next repository task number: 0006; next bug number: 0003.
