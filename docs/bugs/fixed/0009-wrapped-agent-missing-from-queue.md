# Bug 0009: Foreground wrapper hides a running agent

Found: 2026-11-05
State: fixed
Fixed: 2026-11-05

local-machine reported agent reported pane is reported as bash by tmux. Its foreground process-group leader is wrapper.sh, with one Claude child in the same terminal/group. Queue prefilter skips bash; observe also assumes the group leader is the CLI. Use bounded kernel process evidence for a unique foreground-terminal CLI child, preserving direct CLI identity hashes and all action guards. No launch script contents or prompt arguments needed to diagnose it.

[Task 0014](../../tasks/done/0014-wrapped-agent-discovery.md)

Resolution: bounded shared foreground wrapper resolver plus one batched per-host discovery. Fixture safety/regression checks pass; deployed and live verified reported agent now appears. Existing direct identities/preferences unchanged.
