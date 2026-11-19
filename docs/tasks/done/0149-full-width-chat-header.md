# Task0149: Full-width desktop chat header

Claimed2026-11-18 by CC-dev. Replace folder-tab title treatment with a full-width, stronger themed header surface. Keep compact title/actions, native/ACP ownership and mobile layout. Validate build and existing responsive browser coverage; inspect screenshot.

## Completed2026-11-18

Desktop header spans conversation width with an opaque theme-token surface (88% surface,12% text), rounded upper corners and a shared edge with the conversation. Title is plain and vertically centered; actions remain compact. Mobile treatment unchanged. Removed obsolete header badge styling; reference updated.

Validation: frontend build passed; six focused Playwright cases passed at desktop1440/1366/1280 and compact393/852 widths, covering full-width geometry, native/ACP/pi switching, Details, drafts and responsive round trips. Updated obsolete tab-bottom geometry assertion to check header/conversation width and edge alignment. Screenshot test-results/chat-tab-cross-provider-1440.png inspected: full-width header, legible title, aligned buttons and no new whitespace. Logs .local/full-width-chat-header-{build,tests}.log. git diff --check passed. No live input, deployment or commit.
