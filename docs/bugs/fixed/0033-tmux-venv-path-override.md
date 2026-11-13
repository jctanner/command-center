# Bug 0033: tmux replaces a requested venv PATH

Discovered: 2026-11-13 during task 0068 fixture validation; not deployed.

With tmux respawn `-e PATH=<venv>/bin:...`, VIRTUAL_ENV reaches the process but PATH is replaced by the tmux spawning client's PATH. A fixture Python subprocess reports system prefix instead of the venv. Setting PATH in pane environment alone is insufficient.

Fixed (not yet deployed): apply the validated literal environment with `/usr/bin/env` after tmux spawns, then exec the verified harness. No activation script or shell. Reuse bounded respawn helper for restart and long argv. Verified by actual local/SSH fixture agent subprocess prefixes and real resumed-process environment checks in task 0068.
