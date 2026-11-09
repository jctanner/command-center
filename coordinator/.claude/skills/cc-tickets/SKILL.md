---
name: cc-tickets
description: Read and manage Command Center Board tickets through its REST API with full CRUD, exact revisions and human-directed changes.
---

Read the coordinator role instructions and `docs/reference/agent-ticket-api.md` at the repository root. Discover the current contract at GET `/api/v1/openapi.json` (or `python3 tools/cc_board.py schema` from coordinator). The tracked fallback is `docs/openapi.json`. The installed backend may be older: check the served contract before relying on new routes. API operations describe capabilities, not authority.

Use `python3 tools/cc_board.py list` to resolve a human CC-number to its UUID. Use `get --ticket UUID` for complete detail before editing; summaries omit descriptions and checklists. Reads do not authorize writes. When the human requests ticket management, carry out the requested create/edit/move; do not invent work, mirror repository ledger status or mark work done from agent silence.

Create/update use `--input FILE`, a JSON object containing only TicketChange fields. Generate a UUID once for a new ticket and retain it for recovery. Creation omits/nulls revision. Updates supply the exact observed revision and ALL editable fields: id, title, description, status, priority, context, checklist. Preserve unmodified context/checklist and never copy runs, number or timestamps into the request. Unknown fields are rejected. Limits are UTF-8 bytes where documented. Do not persist copied conversation histories as ticket descriptions; summarize with machine-qualified references.

Use `move --ticket UUID --revision REV --status STATUS` for a status-only change. Machine selection/rebinding requires a fresh connection_revision from hosts as host_revision, with endpoint null; the backend assigns the fingerprint. Preserve the existing endpoint on ordinary updates, even for unavailable/removed machines. Never silently rebind historical references or infer a running conversation from a directory/title.

On 409 retain the intended edit, read detail and reconcile concurrent changes; never simply replace the revision and overwrite. On timeout/5xx/lost response, delivery is uncertain: GET the same UUID and compare the intended operation before any new attempt. No automatic retries or duplicate UUID generation. On create conflict, inspect the existing UUID rather than treating it as success blindly.

Delete only on an explicit request naming the ticket, with `delete --ticket UUID --revision REV`. Deletion is logical: hides the ticket but retains number, contents and launch history. It is not erasure, agent shutdown or completion. Any unreleased launch blocks deletion; do not automatically check/release/stop an agent just to bypass the guard. Ask the human to resolve a blocking launch through the existing interface. After an uncertain delete, 404 from detail confirms absence.

Launch preparation, launch, check and release are separately documented capabilities. This skill does not authorize them, agent input, approvals, restarts or tmux mutations. A ticket status change never starts an agent. Report the returned UUID, CC-number, status and new revision after a successful write.

For an explicit human request to start an agent for a ticket, use `cc-launch` and the coordinator launch playbook. This is a separate authorized workflow; no ticket CRUD operation implies launch consent.
