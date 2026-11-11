# ADR-0002: Whiteboard editor and authoritative state

Status: Custom roughjs interaction prototype authorized; full shared-state implementation remains proposed.
Date: 2026-11-10
Related: CC-46; [Plan 0002](../plans/0002-whiteboard-workspace.md), [task 0050](../tasks/done/0050-lightweight-whiteboard-prototype.md).

## Context and evidence

CC uses vanilla TypeScript and Rust. The initial isolated Excalidraw/React assessment exported PNG/SVG and retained bound arrows. Its first-open assets compressed to about 528 KB, rising to 2.44 MB with export resources; a much smaller roughjs sample was only a renderer. The initial recommendation favored Excalidraw's mature editing behavior.

The human prioritized lightweight dependencies, declined the need for the full editor, and authorized a custom interaction prototype. That prototype supplies basic drawing/editing and browser exports using pinned MIT roughjs 4.6.6, without React or Excalidraw.

## Current direction

Use custom TypeScript + roughjs for the prototype, separately served from the live CC workspace. Persist its bounded local sketch only in browser storage and label agent interaction as a local demonstration. No shared-state, REST scene API or remote-attachment capability is implied.

If accepted, retain Rust-owned semantic scenes, stable UUIDs/revisions, checked operations and durable history in the existing private Board SQLite sidecar. Implement the small drawing toolset first; defer mature editor features and interoperability until justified. No editor-native ID mapping is needed for custom elements; later imports require an explicit adapter.

Prototype SVG and PNG are browser-generated. Assess a Rust SVG serializer and optional rasterizer for server-side exports before promising render parity; rasterization alone does not implement rough paths/text layout. Do not adopt the initial Node/Chromium worker proposal as a requirement. Remote transfers remain a separately reviewed outbox/SSH feature.

## Consequences and gates

This reduces dependencies and gives CC direct control of interaction, but we own hit testing, arrow binding, touch input, undo and accessibility. The standalone prototype is not evidence that collaboration/conflict handling is implemented. Full build and attachment contracts still require the requested phase check-ins. MIT notices for roughjs and its renderer dependencies ship with the prototype.
