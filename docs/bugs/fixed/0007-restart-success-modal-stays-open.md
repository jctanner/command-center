# Bug 0007: Successful restart leaves only Cancel in modal

Found: 2026-11-05
State: fixed
Fixed: 2026-11-05

The complete status branch hides action buttons but keeps the dialog open with Cancel, making an actual successful restart look unfinished. Close on verified success and show an accessible confirmation. Preserve uncertain-result review controls.

[Task 0011](../../tasks/done/0011-restart-success-feedback.md)

Verified Complete now closes the modal and announces success outside it. Desktop and phone recovery tests pass; frontend deployed.
