# Task0090: Touch-accessible connection-mode switching

Owner: CC dev; claimed 2026-11-17; State: done.

Human cannot switch to ACP on mobile. Root cause: mode switch exists only in the card context menu; narrow-screen tests still right-clicked. Add the guarded action to the existing conversation Details panel, available for native and ACP Codex/Claude, disabled for disconnected/unsupported targets. Verify actual touch navigation without right-click or terminal traffic; preserve backend safeguards and layout.

## Result and validation

Added Switch connection mode to native and ACP conversation Details panels, using the same queue callback and backend review. Native unsupported/disconnected targets are disabled; ACP unavailable/pending actions disable its control. No changes to backend guards, protocol behavior or terminal attachment.

TypeScript/Vite build to dist-next passed (existing chunk-size advisory); git diff --check passed. Playwright agent-mode.spec.ts and acp.spec.ts against the release binary: 24 passed. Two new tests use a 393×852 mobile/touch browser context and tap only: open card, Details, mode review, explicit switch, then reverse through ACP Details. Both harnesses retain exact conversation, no mutation before confirmation, two switch submissions only, no horizontal overflow or terminal WebSockets. Initial test exposed the separate ACP panel's missing return action; fixed and final full run passed.

Published frontend-only at 2026-11-17 12:03:42 UTC. Four access paths and index hashes healthy; backend PID/start/executable, configuration and canonical tmux pane PIDs unchanged. Private receipt .local/reviews/mobile-mode-switch-publish.json; build/test logs .local/mobile-mode-{build,browser-final}.log. No backend restart, real-agent conversion, input, commit or push. Reload the mobile client once to load the new UI.
