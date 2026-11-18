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

URL-encode query values with a structured encoder. Keep the task prompt in the POST body, never a query URL. The prompt is at most 24,000 UTF-8 bytes, no control characters except newline/tab; native authentication remains terminal-only; recognized launch-bound folder trust is surfaced for explicit human handling in Agents (see below). Preparations expire after 120 seconds. Retain the launch UUID/endpoint before IO, and keep inspecting that launch rather than allocating another UUID after a timeout. The ticket route is preferable when work should retain its prompt and durable run history in Board.

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

## Native folder trust (CC-72)

A freshly launched Claude or Codex process can be waiting on folder trust before any native conversation exists. A verified running process is not proof it consumed the prompt. Inspect `folder_trust` and `launch_state: awaiting_trust` on Start/status/check; the queue activity is `awaiting_trust`, source `folder_trust`. Surface this to the human with its folder/repository scope and point them to the **Folder trust** controls in Agents. No process-linked conversation is required for this narrowly launch-bound action; ordinary chat remains disabled and its association/guard rules are unchanged.

The coordinator must never call the trust-answer API, edit provider trust files, type keys, inject a shell workaround or add arbitrary bypass/pretrust flags. The human chooses **Trust this folder** or **Decline — leave blocked** in CC. Decline sends no keys and leaves the native prompt blocked; a later fresh human review can change that choice. Trust confirmation uses an expiring one-use capability tied to endpoint, launch UUID, process/start identity, canonical directory/root and full live disclosure. Navigation is limited to the recognized picker and is reverified before a single Enter. Actor labels describe explicit human intent under the trusted-access boundary, not authenticated named-user identity.

Decision UUID/receipt/claim is durable before native input; browser/backend interruption never causes automatic replay. `submitted` means input attempted successfully, not confirmed harness acceptance. `uncertain` requires terminal inspection. The frontend can read the original receipt at GET `/agents/folder-trust/{id}`. Unsupported/truncated/wrapped layouts, unmarked agents, changed launches, copy mode, stale prompts and post-start trust-like output remain terminal-only. Authentication, provider warnings and unrelated first-run dialogs are not trust capabilities. Per-launch Codex pre-trust is described below. CLI decisions persist only through the provider's normal mechanism, never CC config-file edits.


## Optional per-launch pre-trust (default off)

The human can explicitly tick **Trust exact directory for this launch** for Claude or Codex in either launcher. Preparation review shows the canonical directory and PRE-TRUST choice. API preparation accepts `pre_trust:true` (standalone query boolean or TicketPrepare JSON boolean); omitted/false preserves native prompts. Start cannot override the choice: it is bound into the expiring one-use grant, endpoint, canonical directory identity and installed executable identity. It is returned in preparation/status, saved in tmux launch metadata and persisted on ticket run receipts before launch IO. Pi rejects true. Changing directory, machine or harness clears UI consent; changing any preparation input requires a new grant.

This is explicit human consent at prepare time for **one** normal, guarded native trust decision, not a CLI bypass or trust-file edit. Immediately after a verified launch, a bounded owned backend task watches for a supported prompt from that original process. It requires the exact prepared folder and directory identity, launch UUID, provider, and an identical trust root. A wider Git repository root is never authorized by trusting a subdirectory; review it separately in Agents. A prior decision, unsupported/authentication dialog, changed process/endpoint/scope, unavailable evidence, or a prompt that appears after this startup window leaves review to the human. The task is never resumed/retried by Check launch or backend restart.

Before sending any key it uses the same durable UUID/claim, one-use capability, endpoint lock, process/start/screen checks and bounded native picker navigation as the human control. The trust receipt records `preauthorized:true` and explicit human preparation consent; the ticket run retains `pre_trust_result`. A submitted confirmation is not proof of provider acceptance, and uncertain delivery never replays. CC writes no provider trust files and supplies no skip-permissions, hook-trust bypass, environment bypass or arbitrary client flags. The native provider may save its ordinary decision itself.

The coordinator never answers native trust prompts or calls their decision API. It may carry `pre_trust:true` in preparation only when the human explicitly requested exact-directory trust for that particular launch. A request to launch, previous trust, parent trust or automatic tool review does not imply consent. Otherwise omit it, report `awaiting_trust` and direct the human to the guarded UI. Pre-trust does not authorize tools, follow-up messages or trust for another folder/process.

### Named native tmux sessions (CC-103)

Native standalone `launch-options` and ticket `prepare` accept `target_session_name` instead of `target_session`. Omit both for the existing dedicated-session default. Names are literal: 1–64 ASCII letters/digits/underscores/hyphens, first character alphanumeric; `cc-view-` is reserved. No shell interpretation or tmux prefix matching.

Preparation binds either the exact existing stable session/server creation identity or absence of that exact name. Start rechecks it: an appeared, vanished, renamed or replaced destination returns 409, requiring fresh preparation; no automatic fallback or retry. A simultaneous create loses safely to tmux's duplicate-name check. Prepare each restore after the preceding launch has completed. An existing session receives a new detached window; an absent name creates a detached session at the normal fixed size. Other client selection, sizes and processes are preserved. Native pi/Claude/Codex resume continues through the standalone Start's explicitly selected `conversation`; ticket launches still start new conversations. ACP destinations are unchanged.

Example: prepare with `provider=pi`, `path=/absolute/project`, fresh `connection_revision`, and `target_session_name=work`; review its canonical project, `target_session` (resolved ID or null) and name, then persist the launch UUID/endpoint and Start once with the returned token and chosen conversation ID. Subsequent freshly prepared launches add windows to `work`. Ticket run receipts and launch metadata retain the requested name. Coordinator agents use only the guarded API, never SSH/tmux, and never infer a conversation ID or retry uncertain Start.

## Container Goose (CC-100)

Native Goose uses the normal guarded standalone/ticket launcher with provider goose; read [native Goose](native-goose.md) for host setup, exact session association and input/status limitations. Use the container path below only when requested. A container Goose launch uses ACP. Use the cc-container-profiles skill and [container reference](acp-containers.md): discover machine-local profiles, map host sources to container targets, prepare with provider goose/container_profile/path and only scoped container_overrides, then review container_review before the single Start. Persist the broker UUID and attempted phase privately first. Profiles support cached images on local Docker or rootless Podman, with no implicit install/pull. Profile editing is a separate revision-checked configuration action and never updates existing agents; v2 restarts retain saved configuration/image/state. Native ticket launching is unchanged. Host Goose is permitted for native launching; container operations never install it. Tool approvals stay with the human. An absent/uncertain startup never authorizes a replacement.
