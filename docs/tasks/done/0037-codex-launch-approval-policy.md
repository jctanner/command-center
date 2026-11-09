# Task 0037: Codex launch approval policy

Owner: CC dev
Claimed: 2026-11-08
State: done

Add optional default/approve-for-me policy to standalone and ticket preparation, bind to launch grants and durable metadata, verify target CLI support before mutation, expose both frontend launchers and document coordinator usage. Preserve defaults and existing launch guards.

Implemented optional approval_policy in standalone/ticket preparation and immutable grants. Omitted/null/default preserves harness defaults; approve-for-me is Codex-only and emits the literal --approve-for-me flag. Exact installed executable help is checked with a bounded timeout during preparation and again before tmux creation. Unsupported/malformed policies fail explicitly. Launch metadata/status and durable ticket receipts retain normalized policy with legacy defaults. Both launch dialogs expose the choice, invalidate preparation on edits and reset policy on machine/provider changes. Coordinator instructions now select the real field under the standing user preference. OpenAPI and API references updated.

Validation:
- Four new Python policy tests pass, covering allowed values, exact flag matching, timeouts/failures, and no tmux mutation on unsupported Start; four existing restart tests pass.
- cargo fmt --check, 44 Rust library tests, Clippy all-targets with -D warnings, debug/release builds pass. Initial sandbox Rust run had two socket-permission failures; rerun with loopback access passed all 44.
- Frontend TypeScript/Vite staging build passes (existing bundling warnings).
- Six focused Playwright tests pass in 25s: standalone fresh/resume defaults, model overrides, ticket provider prompts, existing ticket mobile flow, policy local/SSH API/receipts/grant override rejection, both mobile policy controls/reset/invalidation. Fixtures use synthetic providers only. Initial new test assertions corrected for the actual 422 unknown-field response and title-based card accessibility label.
- git diff --check passes.

Deployed release backend with exact previous argv/environment and staged frontend while retaining old hashed assets. All four configured access paths healthy; served contract includes policy. Configuration hashes and original tmux pane process inventory unchanged. No real agents launched/restarted, provider settings edited, messages sent, or live tickets changed. Existing agent restart semantics remain unchanged.
