# 2026-11-06: Desktop header theme selector

Completed [Task 0023](../tasks/done/0023-desktop-header-theme-selector.md). Native header theme dropdown appears at 1440+ CSS pixels with a fine pointer, synchronized with Appearance and other tabs using the existing browser preference. It hides on smaller/touch-first clients; Settings remains available. Full navigation/clock/status fit a single row at 1440 and 1920.

Frontend build, six theme tests and focused native keyboard/terminal-isolation check pass; screenshots reviewed, diff clean. Frontend deployed atomically, old index backed up privately; backend/terminal/config state preserved and loopback/HTTPS verified. Reload app. The owner subsequently authorized commit/push. Task 0009 pending; next task 0024, bug 0015.
