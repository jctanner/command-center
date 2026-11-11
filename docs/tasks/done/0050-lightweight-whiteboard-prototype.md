# Task 0050: Lightweight Whiteboard interaction prototype

Owner: CC dev
Claimed: 2026-11-10
State: done (interaction prototype; shared API and remote attachments remain deferred)
Related: CC-46. Human approved prototyping the revised custom TypeScript + roughjs approach, not the full shared-state/attachment build.

Build a standalone same-origin prototype with useful drawing interactions, bound arrows, draft-safe undo/redo, touch pan/zoom, browser-only persistence, theme support and exports. Keep live Board/outbox/SSH and terminal activity untouched. Validate browser behavior and publish static assets without service restart so the human can try it. Update the proposed engine decision with measured evidence.

## Implementation

Standalone `/whiteboard-prototype.html` uses custom vanilla TypeScript + pinned roughjs 4.6.6. It is a separate Vite entry and imports no Agents/tmux code. Includes rectangle/ellipse/diamond, sticky notes, text editing, ID-bound arrows, freehand, select/move/resize, Shift selection, eraser, duplicate/delete, pan/zoom, undo/redo, clean lines and CC themes. SVG labels use literal text nodes. Seeded CC diagram plus an explicitly local Agent view demonstrates semantic readback and flow placement; it is not an agent API.

Browser-only bounded scene storage (300 objects, 1 MB serialized data), validation on load, bounded stroke/text lengths and 50 undo snapshots. SVG/PNG/JSON export uses local Blob downloads with pixel/dimension limits and no remote asset fetching. Native touch drawing/pinch handled with Pointer Events. Compact inspector starts collapsed. MIT notices for roughjs and four renderer dependencies ship in public/licenses/roughjs.txt.

Updated proposed ADR-0002/Plan 0002 to record the human's lightweight preference and separate the earlier Excalidraw alternative. No React/Excalidraw or Node/Chromium production renderer dependency was added.

## Validation and publication

- npm run build -- --outDir dist-next (web/) passes with existing bundling warnings. Initial bundled rough import lacked TypeScript declarations; use package entry for typed ESM resolution. An npm invocation from repository root failed; corrected web-directory invocation passed.
- Four final Playwright cases passed in 5.2s: prototype desktop editing, bound-arrow movement/creation, resize, undo/redo, literal markup, simulated agent additions, browser reload and PNG/SVG/JSON download; mobile native touch drawing/pinch, viewport and theme; two existing queue machine-error regressions. Zero API requests/terminal sockets in prototype cases.
- Initial desktop test found reentrant textarea removal through blur; clearing its blur handler before removing fixed it. Final tests record no page exceptions.
- Desktop dark and mobile light screenshots visually inspected. Chromium touch emulation is covered; actual iPhone remains untested. PNG export verified to produce a download, not pixel-compared for font parity.
- Prototype bundle about 48.1 KB raw / 17.1 KB gzipped; full observed page asset bodies 92,062 bytes / 29,661 independently gzipped, including HTML/CSS/shared themes. Gzip sums are estimates, not server transfer measurements. No missing assets, page errors, API requests or terminal sockets on read-only live verification.
- Published separate HTML and hashed assets, preserving the exact original live index hash. No service restart, Board mutation, remote transfer, agent message or native process change. Evidence/screenshots in ignored .local/reviews. git diff --check passes.

## Remaining scope

This is a single-browser sketch, not the shared multi-client Whiteboard. Backend storage/revisions, agent CRUD/layout/export APIs, multiple named boards, image paste/import, advanced editing and guarded attachments are not implemented. Human can assess interaction at the prototype page before approving the shared build. Next task 0051, next bug 0028.
