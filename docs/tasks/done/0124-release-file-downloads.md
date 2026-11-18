# Task0124: Release machine-qualified file downloads

Claimed2026-11-18 by CC-dev. Human explicitly requests commit, push and deploy task0123. Build release/frontend, push over SSH, back up and preserve production listeners/arguments/environment/config plus live local/remote pane processes. Verify all access paths and binary download route with a disposable fixture, without reading personal artifacts or restarting agents.

## Completed2026-11-18

Feature7fe34a4 committed and pushed to origin/main over SSH. Release/frontend builds passed. Authorized deployment completed16:21:57UTC after mutation preflight and backups. All four access paths, full served OpenAPI, running release binary, entry assets and SSE verified. Exact production arguments/environment/SSH agent/listeners/config retained; local unique pane/PID pairs and all9 remote unique pane/PID pairs unchanged. No remote active ACP brokers before/after. No agent input, restart, conversion or personal artifact read.

A disposable local2,097,408-byte binary fixture with a UTF-8 filename was downloaded through loopback, LAN, tailnet and HTTPS. SHA-256 bytes, Content-Length, attachment filename encoding, no-store/nosniff headers and stale-version409 verified; temporary fixture removed. Private evidence .local/reviews/file-downloads-deployment.json, file-downloads-release-agents-before.json/after.json and file-downloads-live-api.json; logs .local/file-download-{release,release-web,deploy}.log. Source tree clean at deployment.
