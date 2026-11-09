# Bug 0022: Claude paste envelope visible in chat

State: fixed

Claude stores long pasted human input inside matching pasted_content ID tags. CC correctly recognizes these envelopes for receipt confirmation but renders the native wrapper literally in user bubbles. Use exact Seen receipt evidence for display-only cleanup; never strip arbitrary XML or alter native logs/cursors. See task 0040.

Fixed in [task 0040](../../tasks/done/0040-claude-paste-wrapper-display.md) using exact same-scope Seen receipt evidence for display-only cleanup. Three provider display tests and existing handoff/native receipt regressions pass. Deployed and verified against the affected live bubble without input actions.
