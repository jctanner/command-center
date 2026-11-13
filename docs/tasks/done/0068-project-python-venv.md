# Task 0068: Project Python venv for agent launch/restart

Owner: CC dev
Claimed: 2026-11-13
State: done

Optional literal Python venv directory, project-relative or absolute, saved with machine-qualified project pins. Bind validated directory/interpreter identity into launch grants; prepend bin to PATH and set VIRTUAL_ENV without sourcing scripts. Preserve on exact-process restart, fail closed if missing/replaced. Frontend and ticket/coordinator API support; retain old defaults and existing pin edits. Tests: environment inheritance, invalid/replaced venv before tmux mutations, restart, config/API and launcher UI. No live agents launched/restarted; disruptive deployment needs approval. No commit/push requested.

## Implementation

- Optional `python_venv` saved on the existing machine/project pin; omitted/null pin edits preserve it and empty clears it. Config validation rejects oversized/control-bearing values. Existing Files and machine edits retain it.
- Standalone launch-options and ticket prepare accept a literal project-relative/absolute override; omit/null inherits the canonical project default and explicit empty disables it. Preparation validates directory/bin/pyvenv.cfg/interpreter metadata; start rechecks before tmux creation. Internal venv identities remain server-side. The verified installed CLI stays the harness; only its subprocess environment changes.
- PATH/VIRTUAL_ENV and cleared PYTHONHOME are applied after tmux spawning with structured `/usr/bin/env` arguments, never an activation script/shell. [Bug 0033](../../bugs/fixed/0033-tmux-venv-path-override.md) records why tmux `-e PATH` alone is insufficient. Shared bounded respawn helper handles long argv and restart.
- Restart observes only the allowlisted VIRTUAL_ENV value, validates and binds it into the exact-process/conversation plan and preserves it on resume. Missing/replaced venv fails before process replacement. UI preview exposes the venv; defaults never silently change a live process's environment.
- Launcher exposes optional Python venv plus Remember (pins project), shows the canonical prepared path, and keeps separate per-launch values. Tickets support overrides and inherit saved defaults; canonical venv is retained in durable run receipts. Coordinator launch/restart guidance, OpenAPI, API docs and AGENTS updated.

## Validation

- `cargo fmt --check`; `cargo clippy --all-targets -- -D warnings`; release backend and frontend (`npm --prefix web run build -- --outDir dist-next`) builds: passed.
- `cargo test --lib --quiet`: 77 passed with isolated-loopback permission. Initial sandbox attempt denied listener creation in two existing tests; authorized fixture rerun passed.
- Python unit suites `test_launch_venv.py`, `test_agent_restart.py`, `test_launch_approval_policy.py`: 12 passed. Covers real venv Python prefix, literal punctuation paths, missing/invalid/replaced environments before tmux IO, exact resume plans and policy guards.
- `python3 -m unittest tests.test_openapi.Contract`: 1 passed.
- `CC_BINARY=../target/release/command-center CC_WEB_DIR=dist-next npx playwright test tests/launch.spec.ts tests/restart.spec.ts` from web: 50 passed. Isolated native tmux plus SSH fixture verify actual pi subprocess Python prefix/PATH, local/remote launches, remembered defaults/rename preservation, inherited ticket launches/receipts, one-launch disabling, restart of a manually activated venv in the actual resumed process, old launch/restart/message/process/phone safeguards. Test fixture logs now write atomically; resume fixtures explicitly select their intended project and create an inactive candidate instead of depending on previous tests.
- Desktop launcher screenshot inspected: venv field, inline remember control and canonical environment feedback visible. Existing phone launch tests pass; actual iPhone behavior not claimed.
- `git diff --check`: passed. Private logs `/tmp/cc-venv-*`; screenshots under ignored test-results.
- Read-only live CC shared-filesystem check confirmed personal-assistant's existing `.venv` has bin and pyvenv.cfg on rhlaptop. No source environment, production settings, agents or sessions changed.

## Handoff / deployment approval pending

Prepared `/tmp/cc-deploy-agent-venv.py`, syntax-checked, not executed. Joint release preserves argv/env/listeners/native pane process inventory, backs up assets/database/runtime and retains prior SSE checks across all four access paths. Then validates the existing personal-assistant `.venv` through launch preparation only, saves its machine/project default with fresh settings revision, and verifies omitted launch venv inherits it. Private source identity comes from current integration metadata, not public hardcoded machine paths; changed source fails closed. No live launch/restart is performed. Human approval required before backend restart per project rules. No commit/push requested for this work.

## Approved deployment

Human replied Proceed on 2026-11-13. Executed `/tmp/cc-deploy-agent-venv.py` successfully: all four configured access paths healthy; initial SSE invalidation verified; runtime argv/environment/listeners and native tmux pane/process inventory preserved. Pre-default configuration hashes unchanged. Runtime/database/assets backed up privately.

Validated rhlaptop personal-assistant's existing `.venv` via shared launch preparation, saved the project default using a fresh settings revision, then verified preparation without an override inherited the same canonical venv. This is the sole intended configuration change. No live agents launched/restarted or source environments changed; no drawings edited. Existing clients need one reload for the new frontend. Commit/push remains unrequested.
