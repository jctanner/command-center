# Bug0050: ACP bang input silently selected broker execution

Status: ownership clarification deployed2026-11-17T23:34:27Z (task0109); existing brokers are not hot-patched. Human clarification2026-11-17; owner CC dev. Related [task0108](../../tasks/blocked/0108-harness-owned-shell-commands.md).

Typing !pwd in ACP selected CC's /bin/sh subprocess runner, while the human meant the harness's native no-model shell mode with its own session/context behavior. Broker output never reached harness context, so this was not equivalent.

Correction: bang input disables ordinary submit/Enter and explains current adapter limitation. Explicit Run via CC broker and Send as chat remain distinct choices. Broker content is labeled by execution owner. local_command requires execution=cc_broker at typed API and broker dispatcher boundaries; missing/wrong acknowledgement rejects without execution, including older cached composers. Broker tmux terminal uses explicit /broker COMMAND; bang input is refused. Native terminals are unchanged.

Validation: new broker parser/no-fallback/metadata tests and typed request acknowledgement checks pass; desktop/mobile Claude/Codex browser fixtures assert disabled bang submit, unchanged draft/no POST on Enter, explicit broker execution and explicit model-chat routing. Broader regression evidence in task0108. This fixes the misleading fallback only; true native harness command support over ACP remains an adapter integration dependency.

Codex native execution is a subsequent capability-gated source extension in task0110, fixture-tested but not installed/deployed. It does not change the meaning of explicit broker execution or enable stock/Claude adapters.
