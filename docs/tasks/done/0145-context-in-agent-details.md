# Task0145: Context metrics in agent Details

Claimed2026-11-18 by CC-dev. Move native and ACP detailed context metrics into existing Details content; preserve card meters, live updates and compact disclosure. Validate frontend build and focused browser coverage.

## Completed2026-11-18

Native and ACP metrics now belong to the existing metadata content, moved with Details into its desktop modal or compact disclosure. Removed standalone metrics from both chat roots; card meters and usage update logic unchanged. Updated agent-workspace reference.

Validation: npm run build --prefix web -- --outDir dist-next passed. All20 agents-polish Playwright cases passed, covering metrics isolation, cards, drafts and responsive navigation. Two additional cross-provider runs with explicit ACP hidden/open/closed Details assertions passed. git diff --check passed. Logs: .local/context-details-{build,tests,acp-tests}.log. No backend changes, service restart, agent input, commit or deployment.
