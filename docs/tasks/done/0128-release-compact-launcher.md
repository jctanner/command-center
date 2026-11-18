# Task0128: Release compact launcher and file-link fixes

Claimed2026-11-18 by CC-dev. Human authorizes committing all current CC changes, pushing over SSH and deploying. Includes tasks0125–0127. Frontend-only release: preserve backend and all tmux processes, back up assets, verify all configured access paths and served entry assets. Existing build and focused browser evidence are recorded in tasks0125/0127.

## Completed2026-11-18

Feature b837483 committed and pushed over SSH. Fresh TypeScript/Vite build passed. Frontend-only deployment completed21:05:39UTC with a timestamped asset backup, additive hashed-asset copy and atomic index replacement. All four configured health/index paths and every index-referenced asset verified byte-for-byte. Backend PID/start and local unique tmux pane/PID pairs unchanged; no backend or agent restart, input or launch. Existing71 browser cases and file-link validation are recorded in tasks0125/0127; no application changes since those checks.

Private receipt .local/reviews/compact-launcher-frontend-deployment.json; deployment .local/deploy-compact-launcher.py; build .local/compact-launcher-release-build.log. No Rust/backend changes or remote transport mutation; remote agents were not individually re-inventoried for this frontend-only release.
