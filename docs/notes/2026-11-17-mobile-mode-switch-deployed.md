# Mobile mode switching fixed

Switch was only available via card right-click. Added the same guarded action to Details in both native and ACP chat. Touch-only mobile tests now exercise both directions for Claude/Codex; final mode/ACP browser suite: 24 passed. Frontend build/diff checks passed. Frontend-only deployment at 12:03:42 UTC verified four access paths, unchanged backend and tmux pane PIDs/configuration. No backend restart or live agent actions, commit or push. Reload once, then open agent → Details → Switch connection mode. See task0090 and bug0044.
