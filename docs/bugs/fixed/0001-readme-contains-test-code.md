# Bug 0001: README begins with pasted test code

Recorded retrospectively: 2026-11-04, after the user reported the clutter.

## Reproduction and actual behavior

Open the repository README at its initial commit (pre-cleanup snapshot). The first line is a Playwright import; hundreds of lines of test implementation precede the first documentation heading. Useful later feature notes are mixed with implementation/validation notes.

## Expected behavior and impact

README should explain the product and how to run it, with links to maintained reference docs. The current file obscures onboarding and encourages further append-only documentation.

## Resolution and verification

Fixed 2026-11-04: reconstructed the 49-line introduction/quick start, preserved useful reference prose under docs/reference/features.md, and verified local links, heading anchors and the absence of pasted test code. The original material remains in Git history; canonical tests remain in web/tests.

## Related task

[Task 0001](../../tasks/done/0001-adopt-work-ledger.md)
