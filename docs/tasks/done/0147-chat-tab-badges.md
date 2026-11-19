# Task0147: Remove duplicate chat tab badges

Claimed2026-11-18 by CC-dev. Human requests removal of routine native status and ACP protocol badges beside chat title. Keep status in cards and Details, preserve conversation feedback, errors and approvals. Validate frontend and focused responsive browser tests.

## Completed2026-11-18

Moved native status badge and ACP protocol label into existing Details content. Chat header retains title, Details, terminal/back controls and explicit project-history warning; card state and conversation feedback/approvals/errors unchanged. Reference updated.

Validation: frontend TypeScript/Vite build passed;20 agents-polish Playwright cases passed, including native/ACP/pi switching with no header state badge, compact round trips, Details and draft preservation. Logs .local/chat-tab-badges-{build,tests}.log. git diff --check passed. Frontend only; no backend checks needed. No deployment, commit, agent input or restart.
