# Task0111: Deploy Codex native shell support

Owner CC dev; claimed2026-11-17; State done. Human requests deployment after approved real test passed. Install the exact reviewed/tested Codex ACP bundle and pinned native runtime offline into the previously absent p15 managed Codex prefix, with atomic no-overwrite publication, private permissions and hashes. Existing PATH has no Codex adapter. Preserve global/native/Claude installations; no agent restart/conversion. Build/deploy CC backend/frontend with all listener/environment/config flags, verify four access paths, live native command contract and local pane PIDs. No commit/push or remote installation requested.

Actual prior validation in task0110: real Codex0.166.0 + patched ACP2.7.0 native execution/context/cancel, zero model POSTs, cleanup and existing pane identity preservation; Rust97/ACP58/mode15/contract6/browser43/adapter34/patch4 checks passed.

## Installed and deployed

- Published the exact real-tested bundle offline to p15's previously absent ~/.local/share/command-center/acp-adapters/codex prefix. Copied only bundled adapter metadata/license and pinned @openai/codex + Linux-x64 runtime packages;52 runtime files hashed and verified. All install files/directories private; executable bits preserved. Linux atomic no-overwrite publication used. No registry/network install, lifecycle scripts, global/native/Claude package replacement, credentials/config change or agent restart.
- Verified discovery using CC's helper with the backend's actual PATH: managed adapter selected and bundle SHA-256 matches the approved real test. Installed native runtime --version returns codex-cli0.166.0 without creating a session.
- Release/frontend builds passed. Deployed2026-11-18T00:38:02Z from the uncommitted working tree. Four access paths healthy; exact backend arguments/environment/config and full local tmux pane/PID inventory unchanged. Running release executable/frontend index verified against staged artifacts.
- Live OpenAPI includes harness_command with mandatory codex_native_full_access acknowledgement, negotiated capability/scope and native-output receipt metadata. Existing native/broker command, ACP queue/restart, usage/trust/whiteboard contracts retained.
- Evidence: ignored .local/reviews/codex-native-shell-{install,discovery,runtime-check,deployment}.json and .local/codex-native-{install,release,release-web,deploy}.log. No live agent/session launched or restarted during this deployment; metadata-only --version readiness check created no session.

## User handoff

Reload CC. New Codex ACP agents on p15 pick up the installed capability. Existing Codex ACP agents require the explicit Restart & update broker action to replace their broker/adapter and resume the same verified conversation. Existing agents were deliberately left running. Stock adapters on other machines and Claude ACP remain unsupported for native bang commands; pi/native defaults remain unchanged. No remote rollout, commit or push performed.
