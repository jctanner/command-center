# Task 0026: Coordinator workspace

Owner: CC dev
Claimed: 2026-11-07
State: done

## Goal

Create a separate coordinator working directory with Claude skills for passive inventory, overlap review and coordination drafts. Use a read-only CLI over the existing Rust API; defer MCP registration, integrated launching and stronger skill isolation.

## Acceptance criteria

- [x] Own role instructions and three scoped skills, with truthful startup documentation.
- [x] Bounded GET-only helper for machines, agents, inventory, projects, conversation history and files; preserve association labels and reject stale process identity.
- [x] Synthetic regression coverage; no live agent launches, messages or history copies.

## Validation evidence

- `python3 -B -W error::ResourceWarning -m unittest discover -s coordinator/tests -v`: nine tests passed. Synthetic HTTP server verifies GET/query encoding, no redirect following, bounded responses and normalized errors. Fixtures cover screen/token omission, honest project association, changed processes/endpoints, history budget/unchanged flags and explicit file truncation.
- `python3 -B coordinator/tools/cc_read.py --help`: all seven read commands available. `git diff --check` passes.
- Checked routes and response shapes against Rust handlers, native history helper and frontend types. Inventory's older route has no revision in its response: guard it with before/after host discovery and qualify the output.
- No Rust/frontend changes; their build suites were not rerun. No live provider session started or agent messages/approvals sent; Claude skill loading and live remote-host coverage remain untested. No service restart/deployment required.

## Handoff

Start the installed Claude CLI from `coordinator/`; README describes the skills and Python helper. This is a manually launched workspace with passive reads and human-reviewable drafts, not yet a built-in card or MCP service. No `.mcp.json` advertises nonexistent tools. Stronger isolation is explicitly deferred by the user. Parent/global skill inheritance remains. No automatic agent orchestration or new mutation authority.

Changes left uncommitted. Task 0009's receipt decision remains unchanged. Next task 0027, bug 0016.
