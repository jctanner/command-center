# Agent work ledger

This repository adopts the [Agent Work Ledger proposal](https://gist.githubusercontent.com/jctanner/7f1d5f132cf3f9b7fc67fbb3e3c8ff4c/raw/0a1381f3b2059825192dd5ccb7055e65c77b9f68/agentic_work_ledger.md) with sortable, immutable filenames for work records.

## Where information belongs

- `README.md`: product introduction, prerequisites, quick start, and documentation links.
- `AGENTS.md`: operating rules, safety constraints, coding conventions, and required checks.
- `PLAN.md`: a short navigation index linking the current milestone, active work, open bugs, decisions, and handoff notes. Keep detailed plans in their own files.
- `docs/plans/`: project/phase plans. `docs/milestones/`: outcomes and acceptance criteria.
- `docs/tasks/{pending,current,blocked,done}/`: executable work items; directory placement is their state.
- `docs/bugs/{open,fixed,wontfix}/`: reproducible defects, including newly discovered unfixed bugs.
- `docs/decisions/`: architectural decision records with an explicit proposed/accepted/superseded status.
- `docs/notes/`: dated session handoffs. `docs/reference/`: maintained feature documentation.
- `docs/templates/`: starting points, not live work records.

## Sortable filenames and identity

Use `NNNN-short-kebab-case-title.md` for **every task, bug, plan, decision, and milestone**, for example:

```text
docs/tasks/current/0002-improve-agent-chat.md
docs/bugs/open/0002-missing-agent-status.md
docs/plans/0002-agent-workspace.md
docs/decisions/0002-agent-event-stream.md
```

Numbers are four-digit, zero-padded, monotonically allocated **per record type across all its state directories**. Task 0002 and bug 0002 are different identities. ADR titles can say ADR-0002, but filenames start with `0002-`, not `ADR-`. Preserve the filename when moving a record; never renumber old records or reuse an existing number. Keep links updated when moving files.

Before creating a record, scan all directories for that type, choose the next number, and create the file exclusively rather than overwriting. Concurrent agents must resolve a numbering conflict before merging. Do not interpret repository task numbers as CC board ticket numbers.

Session notes use `YYYY-MM-DD-short-topic.md`; use a distinct topic when several sessions share a date. Stable handbook/index/reference/template filenames are exempt from the work-record prefix convention.

## Workflow and ownership

1. Read AGENTS.md and PLAN.md, then the relevant records and source.
2. Create or choose a meaningful task. Move it from pending to current and record the owner/claim date before implementation. Respect another agent's claim; do not overwrite their progress.
3. Work in the relevant task file: acceptance criteria, findings, affected files, validation evidence, and remaining work. Create a bug record as soon as a defect is established. Record consequential decisions in an ADR.
4. Move a task to blocked only with a concrete dependency and next action. Update PLAN.md and leave a resumable handoff when pausing or switching agents.
5. Complete acceptance checks and record the actual commands/results or manual evidence. Missing checks are limitations, not passes. Move a task to done only after its criteria are met; move a bug to fixed after its reproduction is addressed and verified. Wontfix needs a reason and decision reference.
6. Update links in PLAN.md and related records after moves. Add a concise dated session note with completed work, discoveries, verification, and the next useful step. Commit records with the relevant implementation when committing work.

For multi-agent work, a coordinator maintains the index and assignments, workers update their claimed records, and a reviewer checks evidence against acceptance criteria. These roles do not authorize launching agents, sending messages, or marking live board tickets done.

## Relationship to the CC Board

This ledger tracks repository implementation and maintenance. The running CC Board manages user tickets and their live agent context. They are separate stores: link a CC ticket explicitly when relevant; do not silently import private board contents, mirror statuses, launch agents, or infer ticket completion from a repository task. In particular, this documentation adoption does not complete CC-1 or change any live ticket.

## Documentation discipline

Keep reasoning, discoveries, handoffs, and validation receipts in the relevant work record. Keep enduring behavior in reference docs and enduring constraints in AGENTS.md. Replace outdated documentation instead of appending another correction at the bottom. Never paste test files, raw command output, private messages, credentials, or machine runtime state into README.md or ledger files. Link canonical tests/source; record concise results. Retrospective records must say they are retrospective and must not invent historical ownership or verification.
