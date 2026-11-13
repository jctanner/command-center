# Coordinator agent launches

The coordinator may execute an explicit human request to launch agents on configured CC machines. This is a narrow permission to use the existing native launcher, including the requested initial task prompt. It is not permission for self-directed launches, arbitrary commands, agent restarts/closures, tool approvals or follow-up messages to other agents. A clear request is sufficient consent: do not ask the human to approve the same launch again just because the caller is an agent. Clarify missing details or material changes instead.

This task grants instructions/capability, not a request to start any live agent now. These workflows use the Rust backend and normal configured SSH/ProxyJump transport; do not change network exposure, source permissions or CLI authentication/configuration. Operating-system/provider tool approvals remain in effect.

## Discover and resolve scope

From `coordinator/`, existing helper commands are:

```sh
python3 tools/cc_read.py hosts
python3 tools/cc_read.py projects --machine MACHINE_ID
python3 tools/cc_read.py inventory --machine MACHINE_ID
python3 tools/cc_board.py list
python3 tools/cc_board.py get --ticket TICKET_UUID
```

Resolve machine aliases to stable IDs; use a fresh connection revision. Directories are machine-qualified absolute paths. Preserve endpoint fingerprints from existing tickets and stop on an endpoint change; explicit reselection is required to rebind. Use the user-selected harness (`codex`, `claude`, `pi`) and optional literal model. A blank model leaves the provider default; no arbitrary flags. Use saved ticket context only when it clearly supplies missing parameters. If essential scope is still ambiguous, ask one concise question.

Default launch creates a dedicated detached tmux session. Optional `target_session` is an observed stable `$ID` on the selected machine, creating a new detached window there. Use it when the user asks for that destination, not merely because a session happens to exist. Optional `window_name` and `card_name` are literal display names. Preserve existing processes, selection and terminal dimensions; no browser terminal viewer is needed.

## Ticket-backed work

The served contract at `GET /api/v1/openapi.json` documents these Board operations. Resolve CC-N to a UUID and read full detail before preparation. Check existing runs first; an unreleased run blocks another launch. Reading/checking a run never authorizes releasing it or starting an additional one.

1. `POST /api/v1/board/tickets/{UUID}/prepare` binds the exact ticket revision and prompt to an expiring one-use grant. The body is `TicketPrepare`:

```json
{
  "revision": "OBSERVED_TICKET_REVISION",
  "host": "MACHINE_ID",
  "connection_revision": "FRESH_CONNECTION_REVISION",
  "path": "/absolute/project",
  "provider": "pi",
  "model": null,
  "prompt": "Implement the work the human requested for this ticket; preserve its constraints and report validation.",
  "target_session": null,
  "window_name": "CC-12",
  "card_name": "CC-12: requested work"
}
```

Use the actual user request and relevant ticket acceptance criteria, not the generic example prompt. Do not inject unrelated work or automatic approval instructions. If the ticket changed, read/reconcile it rather than simply swapping a newer revision into an old plan.

2. Review preparation's canonical `project`, `provider`, optional `model`, target session/names and endpoint against the authorized scope. Record the returned `launch_id`, endpoint, host and ticket UUID before Start. Keep the grant token private. `POST /api/v1/board/tickets/{UUID}/launch` accepts only:

```json
{"token": "ONE_USE_PREPARATION_TOKEN"}
```

The backend persists a run receipt and claims the ticket revision before transport IO. Ticket launches start a fresh native conversation; they do not resume an arbitrary project history. Preparation binds the prompt, so do not add `initial_prompt`, `conversation` or command flags to Start.

3. Observe startup. GET the ticket and verify its unreleased run ID matches your recorded `launch_id`. Then `POST /api/v1/board/tickets/{UUID}/check` with its exact current revision:

```json
{"revision": "CURRENT_TICKET_REVISION"}
```

Check observes the existing launch and records evidence, so GET detail again for the updated revision. It may initialize the requested card name and advance Backlog/Ready to In progress when the original launch is found; it never marks work Done. Keep the actual returned tmux IDs, provider process identity and native conversation identity. A missing/unverified process is not Ready or a reason to relaunch.

## Standalone fresh agents

These existing endpoints are documented in [API v1](../api.md); they are outside the initial coordinator/Board OpenAPI slice. They use the same backend launcher and identity guards.

| Step | Request | Fields |
| --- | --- | --- |
| Prepare | `GET /api/v1/hosts/{ID}/agents/launch-options` | Query: fresh `connection_revision`, absolute `path`, `provider`; optional `model`, `target_session`, `window_name` |
| Start | `POST /api/v1/hosts/{ID}/agents/launch` | JSON: preparation `token`, `conversation:null`, optional literal `initial_prompt` |
| Observe | `GET /api/v1/hosts/{ID}/agents/launch-status` | Query: recorded `launch_id` and stable `endpoint` (preferred for recovery); runtime `connection_revision` is the alternative guard |

URL-encode query values with a structured encoder. Keep the task prompt in the POST body, never a query URL. The prompt is at most 24,000 UTF-8 bytes, no control characters except newline/tab; native auth/trust is handled normally. Preparations expire after 120 seconds. Retain the launch UUID/endpoint before IO, and keep inspecting that launch rather than allocating another UUID after a timeout. The ticket route is preferable when work should retain its prompt and durable run history in Board.

For an explicitly requested agent-card name, prefer the ticket-backed workflow: its backend record/check initializes the verified new process's card name. Standalone Start/status alone do not initialize card metadata; do not claim a card was named merely because preparation accepted a `card_name` field.

Fresh launch is the scope of `cc-launch`. If the user requests resuming an existing conversation, inspect the native resume contract and prove a specific valid, non-running conversation first; do not substitute a fresh launch or select newest/sole project history by guess.

## REST calls and receipts

All paths are relative to the configured trusted CC origin. Use exact Host/Origin checks; POST requires `Origin: scheme://authority` even from scripts. Keep TLS verification enabled. Do not add public listeners or copy remote credentials.

The existing Python classes can make these structured requests without shell interpolation, from `coordinator/`:

```python
import sys
sys.path.insert(0, "tools")
from cc_board import BoardClient

client = BoardClient("http://127.0.0.1:8080")  # Or the configured trusted CC URL.
# client.get("hosts")
# client.get(client.route(machine_id, "agents/launch-options"), **prepare_query)
# client.mutate("POST", "board/tickets/" + ticket_uuid + "/prepare", prepare_body)
# client.mutate("POST", "board/tickets/" + ticket_uuid + "/launch", {"token": token})
```

These are Python API methods, not new `cc_board.py launch` CLI commands. The CRUD CLI remains unchanged. Its HTTP helper never retries mutations. Its generic error text may say to read the ticket; for launch failures, follow the launch-specific recovery above rather than recreating work.

Keep operation receipts outside tracked files, under the repository's `.local/coordinator-launches/` (directory 0700, files 0600). Record only launch metadata/grant and phase, not a second copy of conversation history, terminal captures or credentials. Use atomic private writes and serialize a receipt's Start attempts. Before Start, persist `attempted`; if persistence fails, do not send. On crash/timeout/5xx/lost response, retain `uncertain` and never automatically call Start again. The backend's single-use token and durable ticket claim are additional safeguards, not a reason to retry blindly.

An unused preparation that expires before any Start attempt may be refreshed under the same original request after verifying unchanged scope and no recorded run/attempt. Preserve the old receipt as abandoned. This exception does not apply to attempted, uncertain or missing receipts.

A clear changed plan or separate attempt needs explicit user intent. Do not auto-release runs, rebind endpoints, approve native dialogs or treat a missing response as an absent process. Report starting, verified running, exited, unavailable or uncertain honestly. No live agents should be launched to test these instructions.

## Codex approval policy

For human-requested Codex launches, the standing user preference is `--approve-for-me`. The installed Codex CLI describes it as routing approval requests through automatic review using the workspace-write sandbox. It does not disable sandboxing. Verify support using the target machine’s installed `codex --help`; older installations may differ. Do not substitute `--dangerously-bypass-approvals-and-sandbox`, `--ask-for-approval never`, or a different approval mode. Other providers retain their normal policy. This preference does not authorize launching an agent by itself.

Set `approval_policy: "approve-for-me"` in the ticket prepare JSON, or `approval_policy=approve-for-me` in the standalone launch-options query. Omit/null/`default` preserves harness defaults; the coordinator explicitly selects `approve-for-me` for requested Codex launches under this standing preference. Nondefault policies are rejected for Claude/pi. The backend validates target CLI support during preparation and again before tmux creation, binds the policy into the single-use grant, and stores it in launch metadata and ticket run receipts. Start accepts the token, not a policy override. Unsupported/unavailable help fails explicitly; do not silently downgrade. The frontend exposes Harness default and Automatic review (workspace-write).

Never smuggle flags through model/name/path/prompt fields, edit the provider’s global configuration, or bypass the guarded launcher with SSH/tmux. Do not restart existing agents to apply this preference. Existing agents and restart behavior are unchanged.

## Python venv

For a requested project launch, omit `python_venv` in standalone/ticket preparation to inherit its saved machine-qualified project default. If the human requests a specific environment, pass its literal relative/absolute directory; empty string explicitly disables the default for that launch. Verify the canonical `python_venv` in preparation. CC validates and binds its directory/config/interpreter identities and configures PATH/VIRTUAL_ENV without sourcing shell scripts. Do not launch through SSH, activation commands or arbitrary environment/CLI arguments. If validation fails, report the missing/changed venv; do not silently use system Python or create/install a venv. Defaults are saved via revision-checked project PUT only when requested; omission preserves them. Restart preserves the live process's observed venv after validation, not a newly edited project default. No launch or restart is authorized merely by a saved default.
