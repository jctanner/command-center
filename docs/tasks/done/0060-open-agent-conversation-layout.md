# Task 0060: Open agent conversation layout

Owner: CC dev
Claimed: 2026-11-12
State: done

Apply the human annotations in CC-layout: remove the redundant inner history frame/padding and human-message indent. Keep message backgrounds, the outer conversation/list boundary, composer and scroll semantics. Validate build and desktop/mobile screenshots; publish static assets without service restart. Preserve uncommitted CC-55 image work.

Validation: TypeScript/Vite build passed (existing chunk advisories); existing live-history/pagination/draft/navigation and mobile viewport/keyboard/composer tests both passed. Desktop/mobile synthetic screenshots inspected. Published static assets with private index backup and atomic index replacement; no backend restart. Live read-only desktop/mobile check confirmed history border/padding and user margin at 0px, scrolling auto, zero page errors, writes and terminal sockets. Private screenshots under ignored `.local/reviews/open-agent-chat/`. Uncommitted Whiteboard image work preserved; no commit/push.
