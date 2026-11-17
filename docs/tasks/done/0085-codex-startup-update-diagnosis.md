# Task0085: Diagnose Codex launch stalled before conversation startup

Owner: CC dev; claimed/completed 2026-11-16. State: done (read-only diagnosis).

Human asked to inspect a newly launched agent that appeared not to create a session. Read the queue identity and exact remote tmux pane through strict noninteractive SSH. The foreground Codex process is alive but showing its native update picker (installed0.166.0, offered0.167.2), with Update now, Skip and Skip until next version. It has not reached conversation startup, so no process-linked conversation or reliable turn state exists yet. Unknown in CC follows from that missing evidence.

No keys, prompts, installation, settings changes, launch/restart or deployment performed. Pressing Escape is explicitly labeled skip by the native picker; the human can also choose Skip until next version. The missing startup-menu indication is recorded as bug0042. This diagnosis does not authorize automatic updater responses or global update suppression. No code changes or test-agent launch; evidence is direct live screen/process observation, not a simulated pass.

Follow-up: skipping the updater exposed a separate pre-transcript first-message discovery gap, recorded/fixed in task0086 and bug0043. Update-menu surfacing itself remains bug0042.
