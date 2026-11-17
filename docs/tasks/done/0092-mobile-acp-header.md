# Task0092: Unclipped mobile ACP Details header

Owner: CC dev; claimed 2026-11-17; State: done.

Human sees clipped Details on mobile. ACP header uses a nested titles wrapper, unclassified Details and protocol span inside the native compact grid. Explicitly map title/subtitle, Details and ACP badge onto the shared header grid; preserve accessible expanded touch target. Check header bounds and touch Details access with mobile fixtures, then frontend-only publication without restart.

## Result / validation

ACP titles now use display:contents in the shared compact media policy, Details uses queue-details-button, and ACP protocol uses the shared agent-state grid placement. This eliminates the auto-placed full-height button overflowing the two fixed mobile header rows. Desktop layout unchanged; shared enlarged touch target retained.

TypeScript/Vite build and diff check passed. Seven isolated ACP browser tests passed (Claude/Codex desktop/mobile, messaging, approvals, recovery), with added mobile assertions that Details fits within the header bounds, sits right of the title on its row, and opens the metadata containing Switch connection mode. Visually inspected the updated 393px screenshot: title/subtitle, Details and ACP badge are aligned and unclipped. Evidence .local/mobile-acp-header-{build,browser}.log and test-results/acp-compact-composer-claude.png.

Frontend-only published 2026-11-17 12:12:24 UTC; four access paths/index healthy, backend process/executable, tmux pane PIDs and configuration unchanged. Receipt .local/reviews/mobile-acp-header-publish.json. No backend restart, live-agent action, commit or push. Reload once for new styles. Actual iPhone browser interaction remains manual device coverage.
