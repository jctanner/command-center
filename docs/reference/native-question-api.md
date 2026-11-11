# Native clarification responses

Deployed with guarded answer controls; discover the served OpenAPI contract before use. This is a human answer operation, separate from ordinary chat and tool approvals. Only an explicit human choice or exact Other text for the live question authorizes input; never invent an answer under ordinary coordination/messaging scope.

GET the exact process's `/api/v1/hosts/{host}/agents/conversation` with fresh connection revision and stable session/window/pane. Require matching instance, association process, and selected conversation. A supported `input_request` provides id/title/context, literal choices (id/label/description), text_available/text_max_bytes, and an expiring one-use token. Missing tokens/reason mean terminal-only, not permission to call the message or approval route. Read/old-history views never authorize action.

`POST /api/v1/hosts/{host}/agents/question` (exact Origin required):

```json
{
  "id": "11111111-1111-4111-8111-111111111111",
  "token": "FRESH_QUESTION_TOKEN",
  "choice": "2"
}
```

Use a new UUID once and an actual current choice ID. For Other use `choice: "other"` and `text: "Literal answer"`; no text for a fixed choice. Preserve literal bytes, no trimming/splitting or newline/control/edge-whitespace substitution. Limit is current native pane width minus 12 bytes, capped at 512. The server verifies actual width before IO and literal field read-back before Enter. Unsupported layouts remain terminal-only.

Before POST retain private metadata-only intent (UUID, exact target/instance/conversation/question, attempt state); do not put tokens, answers or private terminal context in tracked notes/logs. Response is `{receipt: ...}`; validate UUID, host, session/window/pane, instance, conversation and question against the original intent. Same UUID/same answer returns the original receipt without another input; changed answer/host reuse is 409. Never allocate a new UUID as an automatic retry.

`GET /api/v1/agents/questions/{id}` inspects an existing receipt. States:

| State | Evidence |
| --- | --- |
| submitting | Durable intent/claim recorded before native IO |
| submitted | Exactly one native Enter handed off after guarded navigation/paste; not proof of provider acceptance |
| uncertain | Input/acknowledgement could not be proved; do not replay |
| rejected | Explicit not-sent evidence; refresh/review before a separate human attempt |

HTTP 400/409/410/422/429 rejects this attempt before input; 5xx/lost response must be inspected by its original UUID. A 404 receipt is not proof of non-delivery. Original prompt claims remain durable across browser/backend restart and cursor movement. Missing native request identity, replaced endpoints/processes/conversations, mismatched menus/text or ambiguous layouts fail closed. No automatic claim release on timeout and no API force-replay/unlock.

Native source is an owner/start/tmux/domain-validated waiting transition (preserving subsecond transition identity, independent of heartbeat) or one matching pending provider AskUserQuestion call in bounded process-linked history. The latter must match original question/options and excludes hidden/sidechain/completed/ambiguous calls. A question may be visible before its tool call is persisted; the native waiting transition still identifies that live request. Screens alone never suffice for a response capability.

Partial navigation/paste failures require inspecting/completing the native terminal, not resending. User text is loaded through a unique tmux paste buffer, bracketed-pasted once and read back before final Enter; no arbitrary shell, flags or command strings are accepted. No one-use answer capability is a tool permission. Compact clients use only HTTP and never attach/resize tmux.
