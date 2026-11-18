# CC-103 named native launch sessions

Task0116 implements and deploys guarded `target_session_name` for standalone/resume and ticket preparation, with both frontend launchers. Existing exact names add detached windows; absent names create detached sessions. Changed resolution fails closed and requires fresh preparation. The coordinator must prepare sequentially for work-session restores and use the saved project venv and explicitly selected conversation. No real restores were performed.

Validation and deployment evidence are in [task0116](../tasks/done/0116-named-agent-launch-sessions.md). Four access paths healthy; listener/environment/config and local pane PIDs preserved. No commit or push requested.
