# Codex native shell ACP extension (CC build)

This is a small, versioned source patch for `@agentclientprotocol/codex-acp`2.7.0 at upstream commit `b9503aef790c5ca473348fb5580de9869bb5174a`. Upstream is Apache-2.0. It is **not** a replacement Codex harness, a broker shell runner, or a published npm package. The reviewed build is installed in CC’s managed adapter prefix on p15; it is not automatically distributed to other hosts. Native tmux launch/polling stays default; stock ACP adapters remain unsupported for this capability.

The extension calls Codex App Server `thread/shellCommand`, never model `turn/start` or a CC subprocess shell. Codex owns its configured shell/directory, native `userShell` items, session context and interruption. This API uses **full account access outside the model sandbox**; CC requires literal `execution:"codex_native_full_access"` acknowledgement and shows that scope before submission. Do not describe it as inheriting the model's approval/sandbox policy.

## Build and verify

Use a clean upstream source tree at the exact reviewed commit. `manifest.json` binds the original and patched hashes of every changed upstream file. The helper has no network/install/launch behavior and refuses changed versions/files, symlink escapes and overwrite. It cannot apply to an installed dist-only package. It does not patch or restart live adapters.

The following commands were exercised from the CC checkout, with the reviewed source under ignored `.local/codex-shell-adapter` (use a clean source tree for the first command):

```sh
python3 adapters/codex-native-shell/apply.py .local/codex-shell-adapter
python3 adapters/codex-native-shell/apply.py .local/codex-shell-adapter --check
```

Then, from that upstream source directory:

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run typecheck
npm run build
node node_modules/vitest/vitest.mjs run --no-file-parallelism --retry=0 src/__tests__/CodexACPAgent/cc-native-shell.test.ts
```

The output is `dist/index.js` with the source tree's existing dependencies. The approved disposable real-harness test passed with bundled Codex0.166.0 on Linux/p15. After explicit deployment approval, that exact bundle and runtime were published offline into p15’s previously absent `~/.local/share/command-center/acp-adapters/codex` prefix, with private permissions, hash verification and atomic no-overwrite. No existing adapter or global native executable was replaced. Other hosts require a separately reviewed installation. No custom runtime installer or automatic npm operation is added to CC. Do not overwrite an installed adapter or put an unreviewed build ahead of it on PATH.

CC's patch guards can also be exercised against the patched source:

```sh
CC_CODEX_ADAPTER_SOURCE=.local/codex-shell-adapter python3 -m unittest discover -s tests -p 'test_codex_shell_extension.py'
```

## Protocol

ACP v1 `initialize.result.agentCapabilities._meta["command-center/native-shell"]` advertises exactly:

```json
{"version":1,"method":"_cc/session/shell","execution":"codex_native_full_access","contextIncluded":true,"timeoutMs":120000,"outputBytes":32768}
```

CC negotiates this exact contract for Codex only. Unknown versions/scopes/types and missing support fail closed. It never probes by sending a speculative executable command. An incompatible overridden native Codex binary can still reject `thread/shellCommand`; that failure is not retried or sent through another path.

`_cc/session/shell` takes `{sessionId, requestId:UUID, command, execution:"codex_native_full_access"}`. The request has no cwd, shell, environment, timeout or policy overrides. The adapter uses its normal serialized prompt lifecycle for subscriptions/cancellation, but chooses the native shell branch before any model prompt dispatch. It registers native-event observers through the existing event bus, preserving stock tool and foreground-state handlers rather than stealing raw JSON-RPC notifications.

The observer matches the exact native thread/turn and `commandExecution.source="userShell"` item. Incremental output appears as a standard `tool_call_update` with the same namespaced metadata. The cumulative text is bounded to32KiB and includes request/turn identity, exit code, truncation and completion flags. The final extension response carries that proof. `contextIncluded:true` requires a matching completed native userShell item and turn completion; it is not a guess from shell silence or ordinary model output. Native harness truncation/persistence rules still apply; CC does not append synthetic records to provider logs.

Native timeout is fixed120seconds; result waiting is bounded130seconds. `session/cancel` uses the existing exact native turn interruption. Unsupported methods, lost connections, invalid proof or stale identities never trigger a model/broker fallback. CC persists its durable one-use receipt and consumes queued intent before extension IO. The adapter additionally keeps512 bounded in-memory result barriers: repeated identical request UUIDs return the original outcome, changed intent rejects, and rejected/uncertain requests never execute again. CC's durable broker receipts remain authoritative across backend/browser restart; adapter restart is a new process and never replays them.

## Coverage and limits

Fixture tests exercise the actual patched ACP router/client against a mock native App Server, including early completion, output bounds, foreign events, no model turn/start, duplicate UUIDs, unsupported API and exact cancellation. CC Rust/Python/Playwright tests cover typed scope, capability validation, broker no-spawn, FIFO, native-context fixture proof and desktop/mobile presentation. Fixture results alone are not real-harness certification; the approved isolated real test described below subsequently passed. Follow AGENTS.md's explicit-scope requirement before real-provider sessions; use throwaway directories/sessions and leave existing agents untouched.

A separate `live_check.py` passed the human-approved disposable p15 check using the actual patched adapter and real Codex0.166.0, with no model POSTs. It verified native pwd, computed output persisted in native provider context and cancellation; all existing pane PIDs were unchanged and test resources were removed. It verifies the patched source, starts only the prototype adapter/native Codex in a temporary HOME/CODEX_HOME, uses a loopback mock model endpoint and placeholder key, sends `pwd`, a computed harmless marker and cancellation, checks native provider context persistence, and rejects any model POST. It kills only its owned process group and removes the temporary home/project afterward. It neither reads live credentials nor touches existing CC/tmux agents. Running it requires explicit human scope under AGENTS.md, then the `--approve-disposable-native-shell` flag; that flag alone does not grant authorization. No production installation or deployment follows automatically.


## p15 rollout

The native integration is deployed in CC; reload the frontend to pick it up. New **Codex (ACP)** launches on p15 select the managed CC build. Existing Codex ACP sessions need the explicit **Restart & update broker…** action to acquire it while resuming the same conversation. Deployment did not restart agents. Claude ACP and stock adapters elsewhere still expose no native-shell capability; broker execution remains a separate explicit choice. See task0111 for release evidence.
