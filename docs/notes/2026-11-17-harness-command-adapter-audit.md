# Native shell commands versus ACP adapter surface

## Findings

The human means native harness interception of ! input, not CC /bin/sh execution and not model-generated tool use. Existing broker subprocess support from task0104 does not implement that behavior; its output is not in provider context.

- Claude: installed @agentclientprotocol/claude-agent-acp0.107.3 uses Claude Agent SDK. Inspected v1 prompt conversion passes ordinary text through; local-command interception covers supported slash commands such as usage/MCP, not bang shell mode. SDK control request types have no native user-shell execution operation. No supported ACP native shell method found; ordinary session/prompt cannot be assumed to provide it. Native TUI behavior remains documented separately.
- Codex: upstream ACP request router/extMethod exposes authentication, model selection, steering, task stop and goals, not native user-shell execution. Underlying generated Codex App Server ClientRequest DOES include thread/shellCommand, with ThreadShellCommandParams(threadId, command, timeoutMs). This is a concrete future adapter-extension path, not an ACP operation currently wired by CC. Its type explicitly says execution is unsandboxed/full access rather than inheriting thread sandbox policy, so do not present a future mapping as sandbox-preserving or blindly use command/exec as equivalent. No installed/running adapter patched and no child stdio hijacked.
- Pi: native ! and !! are handled by its TUI; dedicated RPC bash/abort_bash commands execute through the harness, with excludeFromContext controlling model context inclusion. CC's native pi sessions remain native; adopting RPC is a separate protocol/launch change, not an invisible switch or ACP substitute.
- ACP v1 prompt turns are model interactions. Terminal client capabilities support agent-requested terminal execution, not automatically a native user-shell command endpoint. No speculative private method or arbitrary extension passthrough was added.

## Sources inspected

- Claude installed adapter package, dist/v1/acp-agent.js prompt/startTurn/localCommandMarkdown and dist/prompt-to-claude.js; installed SDK sdk.d.ts control request union.
- https://github.com/agentclientprotocol/claude-agent-acp and https://github.com/agentclientprotocol/codex-acp (public upstream main inspected2026-11-17; main is not certification of installed Codex adapter versions).
- Codex src/AcpAgentRouter.ts, src/CodexAcpServer.ts extMethod, src/CodexAcpClient.ts and generated src/app-server/v2/ThreadShellCommandParams.ts. Cached source under ignored .local/reviews/harness-command-adapter-audit/. Broad fetch stopped once relevant entry points were cached; no source copied into product or dependencies.
- https://agentclientprotocol.com/protocol/v1/prompt-turn
- https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/rpc-commands.md#bash and src/modes/interactive/interactive-mode.ts
- https://code.claude.com/docs/en/interactive-mode#shell-mode-with-prefix

## Implemented correction / remaining dependency

ACP leading bang no longer triggers broker execution on submit/Enter. Native harness operation is honestly unavailable, with explicit Run via CC broker and Send as chat alternatives. Broker receipts distinguish execution owner and omitted context. Broker terminal bang input is rejected; /broker explicitly opts into broker execution. Native tmux input paths are unchanged.

Actual native execution over ACP remains blocked by current adapter support. A future Codex extension can expose its thread-specific native API with reviewed full-access semantics, durable receipts, exact session/process targeting, cancellation and bounded output. Claude needs a documented harness entry point/adapter change; pi needs an explicit RPC/ACP integration decision. Do not claim these exist based on fixture capability metadata, trigger real agents, patch installed packages or replay existing commands.
