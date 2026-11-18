# Task0108: Harness-owned shell commands over ACP

Owner: CC dev; claimed2026-11-17; State: blocked on adapter support; ownership correction implemented locally.

Human clarifies native ! commands must be intercepted/executed by the harness, without model command generation, with native session/context semantics. Investigate current Claude/Codex ACP adapters and pi RPC. Do not conflate broker subprocess execution or model prompting with native harness commands. Implement only evidenced supported routes; fail closed otherwise and expose broker execution as an explicitly different action. Preserve all pending task0106/0107 changes. No real agents, installs, deployment, commit/push or silent process/protocol changes authorized.

## Findings and delivered changes

See [adapter audit](../../notes/2026-11-17-harness-command-adapter-audit.md). Claude installed adapter0.107.3/SDK expose no native client-shell operation; Codex upstream ACP router exposes none although underlying App Server has thread/shellCommand; pi offers a real bash RPC operation but CC pi sessions remain native. ACP terminal capability is not a native user-shell API. No unsupported/private guessed operation was sent, no adapter patched, and no real agent invoked.

Fixed [bug0050](../../bugs/fixed/0050-acp-bang-execution-owner.md): leading bang in ACP no longer means implicit broker execution or model prompt; Enter is disabled and keeps the draft. Run via CC broker and Send as chat are explicit separate alternatives; command/output are labeled CC broker content. local_command requires execution=cc_broker in typed API and broker dispatcher, rejects missing/wrong acknowledgement, and records execution/context_included metadata. The broker terminal refuses !/!! input and supports explicit /broker COMMAND instead. Native message/terminal behavior is unchanged. Snapshots report harness_commands=false rather than inventing provider support. Docs/OpenAPI updated; task0106/0107 work preserved.

## Validation

- Debug backend and frontend TypeScript/Vite builds passed (existing bundle advisory); cargo fmt check, diff check and Clippy all-targets -D warnings passed.
-51 ACP Python tests passed: new no-implicit-terminal execution, explicit /broker parser, metadata and missing-execution rejection.96 Rust tests passed, with typed local_command checks rejecting missing/wrong ownership acknowledgement and forbidden overrides.6 served OpenAPI tests passed.
-41 ACP/mode Playwright tests passed after initial ownership correction, including desktop/mobile no POST/draft preserved on bang Enter and explicit broker/model choices. After adding mandatory execution acknowledgement, all15 affected ACP browser cases passed again; unchanged mode paths retain their41-suite coverage.
- Evidence under ignored .local/harness-command-{build,web,python,rust,clippy,openapi,browser,browser-final}.log. Public upstream source cached only in ignored review directory; no external source added as product/dependency.

## Remaining dependency and handoff

Actual harness-owned ACP execution is NOT implemented or claimed. Codex needs an explicit adapter extension mapping thread/shellCommand with correct thread/output/receipt/cancellation and reviewed execution permissions (the current generated type documents unsandboxed full access). Claude needs a documented native SDK entry point or adapter/harness change; ordinary prompt text is not an equivalent. Pi RPC integration must be explicit and preserve native launch defaults rather than silently replacing live pi sessions. Resume this task when an adapter path/version exists or a scoped adapter implementation is chosen.

No deploy, commit/push, real-provider test/SSH input, live restart, installed adapter update, container work, or uncertain command retry. Existing live brokers retain old bang behavior until an explicitly requested deployment and broker update; corrected frontend alone labels and blocks implicit bang submission to older brokers.


## Follow-up2026-11-17

Human approved deploying the ownership clarification (completed task0109) and building/testing a Codex adapter extension (task0110). Codex prototype and guarded CC path now exist with fixture coverage; they are not installed on live agents or deployed. The approved disposable p15 real-Codex test passed in task0110 (native execution/context/cancel, no model POSTs). Production adapter installation/deployment remain separate. Claude's native SDK path and pi's optional RPC decision remain separate. Do not treat the prototype's fixture capability as a stock-adapter feature.


Codex follow-up: task0111 installed/deployed the tested native capability on p15 after human approval. Claude's adapter path and pi's optional RPC remain separate; stock adapters on other hosts are not implicitly upgraded.
