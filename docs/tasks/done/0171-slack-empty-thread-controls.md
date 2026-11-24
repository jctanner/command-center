# Task0171: Hide no-reply Slack thread controls on desktop

Claimed2026-11-23 by CC-dev. User reports thread button below every Slack message. Existing compact CSS hides no-reply buttons; extend to desktop while preserving reply counts, keyboard focus fallback, mobile gestures and desktop text selection.

## Completed2026-11-23

Moved compact-only no-reply visually-hidden/focus-visible CSS outside media query. Desktop now hides empty-thread buttons without reserving message space; real reply-count links unaffected. Keyboard users can tab to reveal/open the explicit action. Mobile gestures and desktop text selection unchanged.

Validation: frontend build passed. Two existing compact gesture/selection cases passed; final desktop keyboard/selection case passed separately. Desktop test now clicks actual text instead of blank body center and switches to keyboard modality before checking focus-visible. No messages sent or Slack writes. git diff --check passed. Logs .local/slack-empty-thread-{build,tests,desktop}.log. No commit or deployment.
