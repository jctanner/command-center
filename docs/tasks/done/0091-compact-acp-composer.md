# Task0091: Compact ACP mobile composer

Owner: CC dev; claimed 2026-11-17; State: done.

Human reports tall mobile message box/buttons. Existing ACP screenshot confirms raw textarea, Send and disabled Cancel stacked separately, unlike native chat's composer-input row. Reuse that layout, auto-grow a one-line input and show Cancel only during Working/Approval. Preserve accessible names, touch targets, explicit send/cancel and drafts. Validate mobile geometry and existing ACP messaging tests; frontend-only publish without backend restart after checks.

## Result / evidence

ACP now shares the native composer-input row: one-line textarea, inline 44px mobile Send button, and inline Cancel only during Working/Approval. Auto-grow is bounded at 132px and collapses after clearing/restoring drafts; accessible Send/Cancel names and explicit action semantics preserved. Native chat is unchanged.

TypeScript/Vite build and git diff --check passed. Seven ACP Playwright tests passed against the isolated release backend for Claude/Codex, desktop/mobile, message/permission/receipt recovery. Added mobile geometry assertions: composer under90px at rest, Send at least44px, field and Send on the same row, multiline input grows and clearing collapses, Cancel hidden at rest/visible during approval. Initial mobile run caught CSS arrow entering the accessible Send name; explicit aria-label fixed it, and full final run passed. Screenshots test-results/acp-compact-composer-{claude,codex}.png visually checked: compact docked input row. Build retains existing chunk-size advisory.

Frontend-only published 2026-11-17 12:09:47 UTC: four access paths/index healthy, backend process/executable and tmux pane PIDs/configuration unchanged. No backend restart, live-agent input, commit or push. Logs .local/compact-acp-composer-{build,browser-final}.log; private receipt .local/reviews/compact-acp-composer-publish.json. Reload once for the new layout. Actual iPhone keyboard/safe-area interaction remains device-manual coverage, not claimed by browser fixtures.
