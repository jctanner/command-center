# Agent access to CC tickets

The [OpenAPI contract](../openapi.json) is served at `GET /api/v1/openapi.json` by a backend built with this feature. It covers coordinator discovery/history/files and every Board route; other CC workspaces and terminal streams are outside this initial contract. It follows [OpenAPI 3.1.1](https://spec.openapis.org/oas/v3.1.1.html). Consult the served contract to check the installed backend rather than assuming the checkout matches deployment.

Use the configured trusted CC origin. There are no API-key/bearer credentials; existing network access rules and exact Host/Origin checks apply. Every mutation, including command-line requests, requires `Origin: scheme://authority` with no path. Do not disable TLS verification or broaden listeners to use the API. The coordinator's `tools/cc_board.py` handles headers, certificate verification, bounds and errors and never retries a mutation automatically.

## Ticket identity and CRUD

| Operation | Method and path under `/api/v1` | Result |
| --- | --- | --- |
| Discover tickets | `GET /board/tickets` | `{tickets:[...]}`; at most 1,000 visible summaries, newest-created first |
| Read full detail | `GET /board/tickets/{UUID}` | Complete ticket including description, checklist, context, revisions and launch history |
| Create | `POST /board/tickets` | Complete ticket, HTTP 200; omit/null `revision` |
| Update | `POST /board/tickets` | Complete ticket, HTTP 200; exact `revision` and all editable fields required |
| Move status only | `POST /board/tickets/{UUID}/move` | Complete ticket with new revision |
| Delete | `DELETE /board/tickets/{UUID}` | HTTP 204, no response body; exact revision required |

The human label `CC-12` is not a URL key. Find `number:12` in list results and use its `id` UUID. Generate a new UUID once before creation and retain it until delivery is resolved. Ticket revisions are opaque; timestamps and CC numbers cannot substitute for them. Provider conversation-picker IDs, by contrast, are opaque strings, not necessarily UUIDs.

A minimal creation body:

```json
{
  "id": "11111111-1111-4111-8111-111111111111",
  "revision": null,
  "title": "Review shared component ownership",
  "description": "Compare the existing agent plans and propose ownership.",
  "status": "backlog",
  "priority": "normal",
  "context": {},
  "checklist": [{"id": "review", "text": "Review existing evidence", "done": false}],
  "host_revision": null
}
```

Generate your own UUID; the example is synthetic. From `coordinator/`, use `python3 tools/cc_board.py create --input /path/to/new-ticket.json`. For an update, GET detail and construct this same editable-field shape with its real `id` and exact `revision`. Preserve all unedited fields, especially `description`, `context` and `checklist`. Do not post the entire response: `number`, `runs`, `created_at` and `updated_at` are response-only, and unknown request fields are rejected. Partial PATCH/PUT updates are not implemented.

Review is an explicit human-selected workflow stage for work awaiting review; it does not launch/stop agents or mark work complete.

Allowed statuses are `backlog`, `ready`, `in_progress`, `review`, `blocked`, `done`; priorities are `low`, `normal`, `high`, `urgent`. The title must be nonblank, have no control characters and fit 240 UTF-8 bytes. Description permits Markdown, up to 24,000 UTF-8 bytes without NUL. Up to 100 checklist items: nonempty IDs up to 64 bytes, text up to 500 bytes, boolean `done`. Context path is up to 4,096 bytes without controls; other string references are generally up to 240 bytes. Limits expressed in JSON Schema characters are an upper bound; backend UTF-8 byte validation is authoritative. Board JSON bodies are limited to 128 KiB.

For a status-only move, send `{"revision":"OBSERVED_REVISION","status":"ready"}` to `/board/tickets/{UUID}/move`. Status changes never launch/stop agents or infer work completion. Use `done` only when requested or supported by the agreed acceptance criteria.

## Machine and agent context

Context contains `host`, `endpoint`, `session`, `session_name`, `window`, `window_number`, `window_name`, `pane`, `path`, `provider`, `model` and `conversation`. Omitted fields default empty/null, so preserve the full context on edits. Paths and tmux IDs belong to a configured machine/socket; names and window indexes are display references, not stable identities. Saved references do not prove an agent is currently running there.

For new machine selection or explicit reselection: discover `/hosts`, supply its current `connection_revision` as top-level `host_revision`, set `context.host` to its ID, and set `context.endpoint` to null. The backend supplies the stable endpoint fingerprint. Ordinary edits should preserve the existing host/endpoint pair, including historical context after a machine goes offline or is removed. Do not silently rebind references after an SSH/socket/jump-route change. Set host empty only when the user intends to clear the machine binding.

Read native conversation history through fresh queue targets and retain association labels. Do not copy entire histories, credentials or raw terminal captures into ticket descriptions. Prefer concise evidence summaries and machine-qualified file references. The repository filesystem work ledger and live Board are separate stores; do not mirror one into the other automatically.

## Conflicts, deletion and uncertainty

A stale revision, duplicate UUID, wrong machine revision/endpoint, capacity limit or blocked launch can return 409. Keep the proposed draft, GET current detail and reconcile intentionally. Do not replace only the revision and blindly overwrite another client's edits. Missing/deleted tickets return 404; validation errors use 400/422, body overflow 413, invalid Host/Origin 403. API errors generally contain `{"error":"..."}`; framework extraction and origin failures may be plain text.

Delete requires an explicit request identifying the ticket plus `{"revision":"OBSERVED_REVISION"}`. It is **logical deletion**: the row, UUID, CC number, content and launch receipts stay in private SQLite storage, while list/detail/activity no longer expose it. There is no restore endpoint or secure erasure operation. Numbers and UUIDs are never recycled by deletion. Older backends do not know about the deletion markers and can expose retained tickets again; use an updated backend when these markers exist. The visible-ticket limit is 1,000; retained deleted rows do not count against it.

Any unreleased launch blocks deletion, including unknown or starting launches. Use the existing UI to check a launch and explicitly release an eligible missing/exited receipt. A running launch cannot be released. Do not stop agents or auto-release receipts merely to force deletion. Deletion itself never kills a process, closes tmux, changes other tickets or cancels outbox messages.

After timeout, 5xx or a lost response, delivery may be uncertain. Inspect the same UUID before any new action. For create, compare the existing detail to the intended content; do not allocate a duplicate UUID blindly. For update/move, inspect the new revision and fields and preserve concurrent edits. For delete, 404 from detail confirms absence. Helpers never replay uncertain writes.

## Launch operations are separate

The contract also describes `/prepare`, `/launch`, `/check`, `/release`, `/target` and `/board/activity`. They are not ordinary ticket CRUD. Human-reviewed launch preparation binds the ticket revision, machine, canonical directory, CLI identity, optional model/names/destination and literal prompt. Launch consumes a one-use grant and persists a receipt before IO. Never launch work just because a ticket was created/moved, or retry an uncertain launch.

`check` observes an existing launch and updates durable evidence/ticket revision; it can advance backlog/ready to in_progress, never done. Fetch detail afterwards for the new revision. `release` requires an explicitly checked inactive receipt and never stops a process. The coordinator ticket helper and cc-tickets skill expose ticket CRUD. An explicit human launch request can use the separate cc-launch skill and [launch playbook](coordinator-launches.md); inventory or CRUD alone never grants that authority. Agent approvals remain separate.

## Contract validation

From the repository root:

```sh
uv tool run --from openapi-spec-validator openapi-spec-validator docs/openapi.json
cargo test --lib board::tests
cargo build
python3 -B -m unittest discover -s tests -p test_openapi.py -v
python3 -B -m unittest discover -s coordinator/tests -v
```

The schema tests require Python `jsonschema` (install in your development environment if absent). HTTP tests start an isolated backend with an empty host configuration and private temporary database; all ticket data is synthetic. No real agents, tmux sessions or live Board records are changed.

Codex launch preparation accepts optional `approval_policy: "approve-for-me"` for automatic review using the workspace-write sandbox. Omit/null/`default` retains harness defaults. The policy is checked against the target CLI, bound to the grant, and retained in the run receipt. Start accepts no policy override. See [launch policy](coordinator-launches.md#codex-approval-policy).
