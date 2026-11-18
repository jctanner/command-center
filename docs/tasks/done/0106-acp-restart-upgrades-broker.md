# Task0106: ACP restart upgrades the broker

Owner: CC dev; claimed2026-11-17; State: done (local implementation; not deployed).

Human requests a direct upgrade/reconcile action or upgrade implied by Restart. Implement **Restart & update broker…** in ACP Details and the card menu. Use one reviewed, durable handoff directly from ACP to ACP, loading the same verified native conversation in the same tmux pane with current backend broker source. Preserve card metadata, siblings and dimensions; block busy/permission/commands/queued/unresolved inputs. Bind source digest and process/endpoint identity at review; no automatic updates, native intermediate, new conversation, install or uncertain replay. Reuse connection-mode receipt/recovery infrastructure with explicit acp_restart mode. Tests/docs/OpenAPI; do not deploy/restart live agents or commit/push unless requested.

## Implementation

- ACP Details and card context menu now offer **Restart & update broker…**. Explicit review defaults to Cancel and identifies the conversation/project. Restart directly launches the current deployed broker with adapter session/load in the same pane; no native intermediate or new conversation.
- Added `AgentModeTarget.mode=acp_restart` to the existing one-use preparation, durable start/status receipts and OpenAPI. Source, endpoint, broker start/boot, directory, adapter and native conversation verification reuse guarded handoff. Preparation binds current backend broker source SHA-256; status verifies the replacement's copied source, exact session and handoff provenance before transferring card metadata.
- Blocks working/permission/tool/local-command/queued/uncertain states, stale preparation and container profiles. No arbitrary commands/options, automatic adapter installation, process replacement on status or uncertain retries. Close/other native operations remain unchanged. Restart picks up deployed code even when the source was already current; deployment alone still leaves agents untouched.
- Updated ACP and Agents workspace reference docs. The broker's bounded in-memory history may be reconstructed from adapter replay, while persisted provider conversation identity is preserved; drafts/old receipts are not resent.

## Validation

- Debug backend and TypeScript/Vite frontend builds passed (existing bundle-size advisory); formatting, Clippy all-targets with -D warnings and diff checks passed.
- Rust library suite:96 passed. Mode helper Python:15 passed, including current-source binding, stale-plan rejection before mutation and container no-host-fallback. Served OpenAPI:6 passed.
- Five new Playwright cases pass: Claude/Codex desktop1440px and phone393px actual Details/menu review and confirmation, cancel without mutation, same session/project/card/pin, stable sibling PID/dimensions, new broker capabilities and duplicate-start rejection; fifth case proves late-busy not_sent and lost acknowledgement/reload recovery with one replacement only.
- Combined ACP/mode run:39 passed of41; two preexisting command-close tests raced their snapshot read ahead of queue acknowledgement. Added a visible Queued receipt wait (stronger acceptance synchronization); both passed on targeted rerun. All41 cases verified across those runs. Initial four focused restart cases also passed before full coverage.
- Logs: ignored `.local/acp-restart-{build,web,clippy,rust,python,openapi,browser,browser-all,command-browser}.log`.

## Handoff

No commit/push/deploy, live coordinator restart, provider/package update or real remote-agent input. Tests use disposable adapters and isolated local tmux/backend fixtures; no real SSH/provider restart coverage claimed. After deployment the human can use Details or card menu directly; their click briefly replaces only that agent/broker, preserving the conversation and siblings. Unsupported old brokers without handoff capability fail closed.
