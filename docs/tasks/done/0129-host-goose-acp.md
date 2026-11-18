# Task0129: Host-installed Goose ACP

Claimed2026-11-18 by CC-dev. Human requests Goose ACP without a container. Add explicit host launch alongside retained profile/container launch, exact executable/directory guards, approve-mode stdio broker, saved-session restart, launcher/API/docs and focused lifecycle/browser regressions. Native launch/polling stays default. No production deploy, commit/push or existing-agent restart requested.

## Completed2026-11-18

Start agent adds **ACP broker · Goose** alongside the existing native Goose and **ACP container · Goose**. ACP prepare with provider goose and no profile resolves the installed host executable; a profile always selects container validation, with no host fallback. Start rechecks canonical directory/executable and bound state-directory environment. Host broker runs fixed `[goose, acp]` with approve mode using host provider configuration; no install, arbitrary flags or credential forwarding/storage. Host/container recovery is persisted distinctly; legacy Goose receipts remain container receipts.

Existing ACP cards/chat, streaming, explicit permission options, follow-up queue, cancellation, durable receipts, terminal broker interaction and close are reused. Host Goose exact-session Restart & update broker uses session/load, without reading container metadata or inventing a new conversation. Changed state-directory environment fails before mutation. Container restart retains its existing review/image/state guards. Goose native mode conversion remains unavailable and its UI control disabled. API/OpenAPI, operating reference, native Goose reference and coordinator launch skill updated.

## Validation

- TypeScript/Vite build passed (existing chunk warning only); cargo fmt check, cargo build and Clippy all-targets with -D warnings passed.
- Rust library98 passed. Initial sandbox run blocked two loopback tests; rerun with socket access passed all98.
- Python ACP82 passed, agent-mode20 passed, OpenAPI6 passed and container contract2 passed. Coverage includes fixed argv/approve mode, explicit container selection/no fallback, binary replacement, state-home replacement/no credential retention, correct host cwd, exact session/load and native-mode rejection. Initial restricted broker run could not bind Unix sockets; authorized isolated rerun passed. Existing Python resource warnings remain.
- Browser37 passed:26 ACP (now including Goose desktop/mobile, uncertain-launch recovery, busy queues, usage, explicit broker commands and close),5 container-profile regressions,1 additional guarded host-Goose restart case and5 existing Claude/Codex restart/stale-target regressions. Phone Goose chat screenshot inspected; no layout overflow or terminal viewer attachment.
- Real installed Goose1.60.1 on rhlaptop passed host ACP startup, streamed response, exact-session broker restart/load and second response. Isolated tmux server, throwaway Goose home/project and local OpenAI-compatible mock model used;2 requests, no real provider credentials or live agents. All test brokers, tmux server and temporary files removed. Remote test ran current fixed helpers through the existing shared SSH route, not a deployed production backend; browser/API coverage uses synthetic harnesses. Real provider authentication and real tool execution were not exercised; approval flow covered with ACP fixtures.
- Private evidence: .local/reviews/host-goose-acp-e2e.txt; scripts .local/host-goose-acp-e2e*.py; logs .local/host-goose-acp-{python,mode,openapi,contracts,browser,restart,mode-browser,rust,clippy,build,web}.log.
- `git diff --check` passed.

No commit, push, production deploy, existing-agent restart/conversion, native CLI installation or provider configuration changes. Next step is a human-requested release.
