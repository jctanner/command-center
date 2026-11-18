# Task0126: Independent Start agent modal reviews

Claimed2026-11-18 by CC-dev. Human requests Playwright screenshots and independent Claude and Codex usability reviews of Start agent. Capture deployed native/ACP flows at desktop/laptop/phone sizes without launching agents or sending input. Give both reviewers the same neutral screenshot/geometry brief in fresh read-only contexts, prevent cross-reading reviews, and synthesize recommendations. Review only: no product changes, commit/push or deployment requested. Preserve task0125 uncommitted source fix.

## Completed2026-11-18

Seven deployed-modal Playwright captures: native top/bottom at1440x900,1366x768 and393x852, plus desktop Claude ACP. Bounds/scroll/control inventory captured. All mutation requests blocked; zero attempted writes or launches. Captured native content/client heights1416/874 desktop,1416/742 laptop and1554/826 phone.

Independent reviewers used fresh headless CLI sessions, same screenshots/neutral brief and separate outputs. Claude restricted Read-only tools/plan/no-session-persistence completed successfully in63s (claude-opus-5-5); Codex exec read-only/ephemeral completed in34s (gpt-6.1-sol). Both explicitly inspected all seven screenshot files and capture.json. No access to each other's reports or existing conversations. Raw reports under ignored.local/reviews/start-agent-modal-2026-11-18/{claude-review.txt,codex-review.txt}; staged input in a private /tmp review directory.

Both prioritize persistent actions/status, better scan order, desktop grouping, properly attached help/consent and concise location/status presentation. Separate model/help/consent and stale ACP-readiness bugs recorded0053/0054. Findings, reviewer differences, proposed direction and evidence caveats are in docs/notes/2026-11-18-start-agent-modal-review.md. No app changes or deployment; existing uncommitted task0125 fix retained.
