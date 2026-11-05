# Bug 0005: First Pi input cannot be confirmed without a persisted log

Found: 2026-11-05
State: open

The first message dispatches while Pi is Ready but before its session log exists. The receipt has no baseline or conversation. Later exact native input cannot pass the required pre-send log check; Submitted blocks the FIFO and a pending bubble stays below replies. Capture a verified empty-session UUID before sending, not a retrospective text guess. Keep old unanchored receipts for explicit review.

[Task 0009](../../tasks/current/0009-pi-first-message-receipts.md)

Prospective fix deployed and tests pass: capture verified empty Pi session UUID before first delivery. Existing legacy receipt cannot be retrospectively auto-confirmed; user archive choice is pending. Keep this record open until that one-time remediation is reviewed.
