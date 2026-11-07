# 2026-11-06: Notification sound

Completed [Task 0025](../tasks/done/0025-notification-sound.md). Notifications dialog adds optional browser-local chime, volume and Test sound. Existing attention baselines, permission, process scope, read/mute suppression and Web Lock receipts govern playback. Audio receipts are separate so an armed peer can chime after another tab creates the visual alert. Burst limit one chime/two seconds; no old/uncertain replay. Local oscillators only; explicit gesture unlock with reload/autoplay status and safe current-tab mute if persistence fails. Default off; compact controls disabled/no audio contexts.

Frontend build, seven final sound checks, existing two notification regressions and compact-card check pass. Includes native Web Audio scheduling and cross-tab, storage and mute/read tests. Screenshot reviewed; physical audibility/Safari hardware untested. Frontend deployed atomically with index backup, old assets retained and backend/tmux/config state preserved; loopback/HTTPS index/entry verified. No live sound preference enabled, provider input or approval action. Reload and opt in under Notifications.

The owner subsequently authorized committing and pushing Task 0024 and this feature together. Task 0009 consent pending. Next task 0026, bug 0016.
