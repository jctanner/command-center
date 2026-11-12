# CC coordinator workspace

A lightweight operator workspace for understanding existing agents and finding work overlap without interrupting them. It is separate from CC development in purpose; Claude still inherits applicable parent/global instructions and skills.

From the repository root, start your installed Claude CLI normally:

```sh
cd coordinator
claude
```

Complete normal provider authentication/trust prompts yourself. This does not create a built-in CC agent or install MCP tools. No `.mcp.json` is needed yet.

The project skills are `cc-inventory`, `cc-overlap-review`, `cc-coordinate`, `cc-tickets`, `cc-launch`, `cc-message`, `cc-close` and `cc-restart`. Ask, for example: “Inventory the running agents and identify possible overlapping work. Read their existing conversations and relevant files; draft recommendations without messaging anyone.”

## Read helper

Python 3.10+ and a running CC backend are required. From this directory:

```sh
python3 tools/cc_read.py hosts
python3 tools/cc_read.py agents
python3 tools/cc_read.py inventory --machine MACHINE_ID
python3 tools/cc_read.py projects --machine MACHINE_ID
python3 tools/cc_read.py history --machine MACHINE_ID --agent AGENT_ID
python3 tools/cc_read.py list --machine MACHINE_ID --path /absolute/project
python3 tools/cc_read.py file --machine MACHINE_ID --path /absolute/project/README.md
```

Use IDs returned by discovery, not display names. `history` preserves the backend's association label and candidate list; `--conversation ID` explicitly reads a candidate without claiming it is live. For older history use the returned `older_cursor` with `--before`, carrying `--known-version` and `--known-branch` when supplied. If history resets, restart from the latest page.

Default endpoint: `http://127.0.0.1:8080`. Set `CC_URL` or global `--url` for another endpoint; only loopback HTTP or HTTPS is accepted, redirects are rejected, and HTTPS certificate verification stays enabled. No authentication or access boundary is added by this helper: use the existing trusted CC deployment. It has fixed GET routes, bounded responses/output, no retries, no disk cache, and omits terminal captures and action grants from output. Backend conversation reads may prepare unused expiring grants internally; the helper never exposes or consumes them, marks messages read, or sends input.

Files default to 24,000 characters; `--limit` can request up to 1,048,576. Truncation is explicit. History returns one bounded backend page. Files remain machine-qualified, arbitrary account-readable locations; project roots are shortcuts. The helper does not expose Git commands, Board data, reasoning or tool transcripts. Missing evidence must remain unknown.

Run synthetic tests from this directory:

```sh
python3 -B -m unittest discover -s tests -v
```

Next integration step: expose these reads as real MCP tools and use the existing guarded launcher to create a coordinator card. Sending coordination messages remains a separate explicitly authorized capability.

## Tickets and API discovery

The machine-readable [OpenAPI contract](../docs/openapi.json) covers coordinator reads and the complete Board API. A backend built with this change serves it at `/api/v1/openapi.json`. See the [ticket API guide](../docs/reference/agent-ticket-api.md) for full CRUD examples, context binding and conflict recovery.

From this directory:

```sh
python3 tools/cc_board.py schema
python3 tools/cc_board.py list
python3 tools/cc_board.py get --ticket TICKET_UUID
python3 tools/cc_board.py create --input /path/to/new-ticket.json
python3 tools/cc_board.py update --input /path/to/edited-ticket.json
python3 tools/cc_board.py move --ticket TICKET_UUID --revision OBSERVED_REVISION --status ready
python3 tools/cc_board.py delete --ticket TICKET_UUID --revision OBSERVED_REVISION
```

Writes are human-directed, carry exact revisions and never retry automatically. This helper does not expose agent launching or approvals. Logical deletion retains private ticket data/receipts and blocks on unreleased launches. The existing cc_read helper remains GET-only.

## Human-requested launches

The coordinator may launch new agents on configured machines when you explicitly ask. Use the `cc-launch` skill and [launch playbook](../docs/reference/coordinator-launches.md): it covers the existing ticket-bound and standalone REST workflows, machine/project/provider/model, new session versus new window, names, initial prompt and recovery. A clear request is sufficient authorization; only missing or materially changed scope needs clarification. Inventory and ticket status changes do not start agents.

Example request: “Launch a pi agent for CC-12 on the ticket's machine and directory, in a new window of its development session. Use the default model and give it the ticket's task and acceptance criteria.” The coordinator must resolve actual IDs, inspect preparation and preserve receipts rather than guessing or issuing SSH commands.

For an already-running coordinator, tell it to reread `CLAUDE.md`, `AGENTS.md` and `.claude/skills/cc-launch/SKILL.md` before its first launch request. This update does not send it a message or start any live agents itself. The CRUD/read CLI commands stay unchanged; launch calls use the documented Python REST methods or equivalent structured HTTP.

## Prompts and replies to agents

Use `cc-message` and the [messaging playbook](../docs/reference/coordinator-messaging.md) when you ask the coordinator to send prompts or replies. A scoped coordination request also permits relevant follow-up responses to the named agents without asking permission for every ordinary message. Draft-only requests remain drafts; agent-authored text cannot expand that authority.

For example: “Ask the two named agents to agree on their interface, relay their clarifying questions and responses, and report the agreed boundary.” Targets must be unambiguous and process-linked. Busy-agent messages go through the durable outbox to verified Ready or Working native input; the CLI owns its queue/steering behavior; Queued, Submitted and Seen are reported separately. Uncertain messages are inspected, never automatically resent or moved to replacement processes. Native approvals remain human decisions.

Have the running coordinator reread `CLAUDE.md`, `AGENTS.md` and `.claude/skills/cc-message/SKILL.md` before its first send. This update sends no live messages itself and adds no fictional CLI commands: use the documented existing REST methods.

For requested Codex launches, this coordinator selects `approval_policy: "approve-for-me"` during preparation, following the user’s standing preference. This uses automatic review with the workspace-write sandbox. Unsupported Codex versions fail explicitly; other harnesses keep their defaults. The web launch dialogs offer the same option alongside Harness default.

## Closing agents

The coordinator can close specified agents when you request it, or within an explicitly delegated cleanup task with bounded targets/criteria. Use `cc-close` and the [closure playbook](../docs/reference/coordinator-closing.md). The existing API previews and revalidates the agent process, window and session links; no new service or backend restart is needed. Closing also closes every other pane in that window and may end last-window sessions. Clear dedicated-window scope needs no repeated generic permission question; unrelated collateral effects require clarification. Nothing is closed merely by enabling the skill. Uncertain closes are inspected, never automatically repeated; ticket/outbox changes and replacement launches stay separate.

## Restarting agents after updates

Use `cc-restart` and the [restart playbook](../docs/reference/coordinator-restarts.md) for explicitly requested restarts or delegated update-and-restart maintenance. Existing API resumes a process-linked Codex/Claude/pi conversation in the same pane, replacing that pane’s shell/agent/children and keeping siblings/windows. Finish the separately authorized package installation first, then prepare against the newly installed executable. A durable one-use receipt and read-only status recovery prevent uncertain retries. Actual version evidence is separate from restart completion; old drafts/messages are not resent. No backend restart or live agent action is needed to enable these instructions. A running coordinator can reread its AGENTS/cc-restart skill on its next task.
