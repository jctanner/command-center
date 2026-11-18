# Task0120: Release configurable container profiles

Claimed2026-11-18 by CC-dev. Human explicitly requests commit, push and deploy task0119. Build release/frontend assets, preserve exact production arguments/environment/listeners/config and live tmux process identities, inspect in-flight writes, back up and deploy, verify all access paths and served profile contracts. No agent upgrades/restarts, profile edits or new launches are authorized by deployment. Real rhlaptop coverage may remain unavailable; record rather than silently retry or change networking.

## Completed2026-11-18

Feature commit6d67769 pushed to origin/main over SSH. Release/frontend builds passed. Authorized deployment completed14:46:36UTC using private .local/deploy-container-profiles.py, after in-flight mutation checks and backup. Loopback, LAN, tailnet and HTTPS health/index/SSE passed; full served OpenAPI equals source and includes profile settings/overrides/review. Running binary matches release; exact arguments/environment (including SSH agent), listeners and configuration retained. Local unique pane/PID pairs and all8 remote unique pane/PID pairs unchanged; no active remote ACP brokers were present in either snapshot. Read-only live rhlaptop profile-settings/discovery both succeeded with1 legacy-compatible profile; no profile saves, agent input, launches or broker restarts performed.

Private evidence: .local/reviews/container-profiles-deployment.json, profiles-release-agents-before.json/after.json, profiles-live-api.json; release/build/deploy logs under.local. Rhlaptop recovered for these read-only checks; configurable-container lifecycle tests were not rerun and retain task0119's coverage limitation.
