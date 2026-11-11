# Task 0055: Delete whiteboard control

Owner: CC dev
Claimed: 2026-11-11
State: done (implemented, tested and frontend-only published)

Expose existing revision-checked logical board deletion beside Rename. Confirm exact board name with Cancel focused. Block while editing/saving/uncertain drafts; freeze the reviewed revision and prevent navigation/input during deletion. Handle 204, conflict and lost responses without automatic retry. Select a remaining board or show an empty state. Test desktop/mobile, concurrency, cancellation, uncertainty and last-board deletion using isolated fixtures. Frontend-only publication should preserve the live backend/native agents and all user boards.

## Changes and validation

Added Delete whiteboard beside Rename, separate from Delete selected. Modal uses literal board name and focuses Cancel; destructive action targets the reviewed scene UUID/revision. Pending local edits/saves/conflicts block deletion. While confirmation/request is open, polling/edit/navigation cannot move the deletion target. Concurrent edits reject with a review path; Use server version refreshes metadata/picker. Handles empty 204 success, next-board/last-board state and read-only lost-response reconciliation without replaying DELETE. A pending ticket-link lookup cannot retarget metadata onto a replacement selected board.

Frontend type/build and git diff --check pass. Ten focused Playwright tests pass: six new deletion cases plus four existing shared-editing regressions; two extra desktop/mobile confirmation/viewport screenshot checks pass. Covers literal name/default Cancel, cancel with zero writes, exact revision, concurrent edits, lost successful response, unavailable verification retaining the board, unsaved uncertain draft refusal, remaining/empty selection and compact zero-terminal traffic. Phone confirmation screenshot visually inspected. Backend API already implements logical, revision-checked deletion; no Rust/contract change.

Published tested frontend with /tmp/cc-publish-whiteboard-delete.py, retaining prior assets under ignored .local/backups/whiteboard-delete-*. Backend PID/start and canonical local pane/PID inventory unchanged; health and published HTML verified. Live read-only Chromium confirms Delete whiteboard visible, ten vertical tools, zero page errors, failed requests, HTTP writes or terminal WebSockets. Evidence private .local/reviews/whiteboard-delete-live.*. No live boards deleted/edited, agents messaged/restarted, service restart, commit or push.
