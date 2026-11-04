# Task 0001: Adopt the work ledger and repair documentation entry points

Owner: CC dev (this implementation session)
Claimed: 2026-11-04
State: done (directory is authoritative)
Completed: 2026-11-04

## Goal and context

Adopt the user-provided ledger, require sortable work-record filenames, and restore README as an introduction rather than a development transcript.

## Acceptance criteria

- [x] Ledger workflow, templates, state directories, and PLAN index exist.
- [x] Every work record uses an immutable sortable filename prefix.
- [x] AGENTS links the ledger and directs future meaningful work through it.
- [x] README contains a usable quick start, without pasted test code.
- [x] Useful previous reference content remains available under docs.
- [x] Local Markdown links and work-record naming validate.

## Files involved

README.md, PLAN.md, AGENTS.md, docs/work-ledger.md, docs/reference/features.md, docs/testing.md, docs/api.md, docs/plans/, docs/milestones/, docs/tasks/, docs/bugs/, docs/decisions/, docs/templates/, docs/notes/.

## Findings

The old README began with TypeScript/Playwright source and only switched to documentation at the Native pi heading. Canonical tests already live under web/tests. Preserve maintained feature details; remove the duplicated source from the introduction. Existing API documentation also described the entire service as loopback-only despite implemented optional private listeners and an explicit HTTPS origin.

## Validation

Documentation audit passed before finalization: 17 Markdown files, 38 local links, unique four-digit work-record prefixes, and a 49-line README without the duplicated test code. The audit checks relative links/heading anchors and duplicate IDs across state directories. `git diff --check` passed. Final audit after state moves and handoff: 18 Markdown files and 42 local links/anchors passed, as did unique numeric prefixes, dated note naming and completed-task/fixed-bug consistency. Final `git diff --check` passed.

No application code, deployed assets, live configuration or Board records changed. Application tests were not rerun for this documentation-only task; no new runtime behavior is claimed.

## Related records

- [README defect](../../bugs/fixed/0001-readme-contains-test-code.md)
- [Ledger ADR](../../decisions/0001-filesystem-work-ledger.md)
