# Plan 0002: CC-46 shared Whiteboard

Status: Revised direction: lightweight custom roughjs prototype authorized; full shared-state build awaits review.
Date: 2026-11-10
Owner: CC dev
Related: human-supplied CC-46 brief; [assessment task 0049](../tasks/done/0049-whiteboard-design-assessment.md), [proposed ADR-0002](../decisions/0002-whiteboard-engine-and-state.md).

This is a design, not a description of available API endpoints or installed dependencies. No live Board mutation, agent message, deployment or production dependency change is part of the assessment. The checkout was clean at claim time; the brief's warning about uncommitted CC-7 changes was stale.

## Revised direction

The human prioritized lightweight dependencies after the initial assessment and authorized task 0050 to prototype a custom TypeScript + roughjs canvas. The runnable prototype is `/whiteboard-prototype.html`, is published and uses browser-only state and simulated agent drawing, and does not implement the REST/shared-state design below. Current choice and tradeoffs are recorded in ADR-0002. The original Excalidraw proposal below remains an alternative assessment, not approval to add React/Excalidraw or a Node/Chromium runtime.

For the custom first slice, prioritize shapes/text/sticky notes, bound arrows, freehand, select/move/resize, pan/zoom and undo/redo. Defer grouping/align/locking, image paste, Excalidraw import and remote transfers. SVG/JSON and browser PNG are demonstrated; backend PNG needs a separate Rust SVG/rasterization spike, including hand-drawn path/text parity. The shared revision/storage/authority design remains applicable; native editor ID mapping is only needed for later interoperability.

## Original alternative and engine evidence

Embed the MIT-licensed Excalidraw editor as a lazy React island inside CC's vanilla TypeScript Whiteboard workspace. Keep persistence, revision checks, semantic layout and messaging authority in Rust. Do not embed excalidraw.com, use its hosted collaboration service, or migrate other workspaces to React. Avoid tldraw.

Both candidates were built in a temporary directory with production Vite 7.3.7, then opened in Chromium on Linux x86_64 at 1280×852 and 393×852. Packages: Excalidraw 0.18.1, React/ReactDOM 18.3.1, roughjs 4.6.6. External browser requests were blocked. Each sketch drew two labelled boxes and a connection. The roughjs demo is a renderer/clean-toggle sample, not an equivalent editor.

| Observation | Excalidraw island | Custom roughjs sample |
| --- | --- | --- |
| Initial requested assets, independently gzipped | 527,593 bytes | 10,192 bytes |
| Initial requested uncompressed assets | 1,513,396 bytes | 29,520 bytes |
| Visit plus PNG/SVG export resources, independently gzipped | 2,440,278 bytes | 10,192 bytes (SVG only) |
| Entire generated output, excluding separately served fonts | about 8.0 MB | 29.5 KB |
| Separately deployable font collection | about 13.1 MB; loaded font subsets are included in initial-request figures | none in sample |
| Single-run desktop / compact mount observations | 251 / 226 ms | 56 / 49 ms |
| Verified exports | PNG and SVG; two ID-bound arrow endpoints retained | SVG |
| Editing implementation still needed | CC integration, syncing and authority | the editor itself, including hit testing, selection, bindings, undo and touch behavior |

Resource totals are sums of response bodies compressed independently for comparison, not actual HTTP transfer with production compression; the first pass initially conflated export-time resources with initial loading, and the final pass separates them. These are warm local-machine observations without CPU/network throttling, not phone performance claims or feature-equivalent benchmarks. No missing assets, page exceptions or external browser requests were observed. Mobile toolbar rendering was visually inspected; real iPhone drawing/pinch/keyboard behavior remains unverified. A dark-background prototype initially washed out because Excalidraw transforms scene colors in dark mode; using its light-space scene background fixed it. Map CC theme variables to editor chrome/default palette deliberately rather than overwriting every stored element color on a theme switch.

Sources: [editor integration](https://docs.excalidraw.com/docs/@excalidraw/excalidraw/integration), [imperative scene API](https://docs.excalidraw.com/docs/@excalidraw/excalidraw/api/props/excalidraw-api), [Excalidraw MIT license](https://github.com/excalidraw/excalidraw/blob/master/LICENSE), [roughjs renderer and MIT license](https://github.com/rough-stuff/rough), [Excalifont OFL license](https://plus.excalidraw.com/excalifont). Inspected installed 0.18.1 types/source rather than assuming current upstream APIs match that release. Preserve dependency/font notices; do not present the MIT editor license as covering every font/dependency.

## Workspace and UI

Add `#/whiteboard` with a compact named-board picker, New/Rename, optional ticket UUID link, save/conflict feedback, and export/import actions. Ticket linking is metadata only; it neither moves a ticket nor starts an agent. Whiteboard browser selection, camera and current tool are local to each client. No terminal viewer attaches or resizes on Whiteboard, including phones.

Use the editor for select/move/resize, box/ellipse/diamond, bound arrows and lines, freehand, text, eraser, pan/zoom, selection/group/align/duplicate/lock and undo/redo. Implement Sticky as a CC preset of a filled rectangle with bound text, not an assumed built-in sticky tool. Clean means roughness zero for selected/new objects, with hand-drawn as default. Attribution appears in selection details and an optional subtle author outline, without changing the element's chosen stroke color. Touch UI prioritizes canvas space and exposes basic drawing plus pan/zoom. Load all React/editor/CSS/font assets only when opening this workspace; pause polling when hidden and unmount idle rendering without losing unsaved edits.

PNG/JPEG/WebP paste uploads content-addressed assets; preserve dimensions and reject external image URLs. Initial import supports safe supported `.excalidraw` JSON, with preview, size/type limits and clear reports of unsupported content. Strip claimed CC authors/revisions and reject iframe/web embeds or unsafe links; do not execute imported content or fetch URLs. Raw SVG image paste is initially unsupported unless separately sanitized/rasterized. Native CC JSON preserves CC semantics; Excalidraw import/export is an interoperability view and does not promise all CC metadata round-trips.

## Storage, identities and attribution

Extend the existing private `.board.sqlite3` with separate whiteboard tables, using its WAL/FULL synchronous and off-executor access patterns. This preserves one durable store and allows later outbox/export-reference updates in the same transaction; do not move existing config/state files as part of this ticket.

Proposed tables: whiteboards (UUID, name, optional ticket UUID, monotonic scene revision, metadata revision, tombstone), elements (board UUID, CC element UUID, opaque element revision, semantic kind, validated renderer payload, relations, author metadata, tombstone), operations (UUID, request digest, result revision), history/checkpoints, and content-addressed binary assets/exports. Bounded SQLite BLOBs avoid a new arbitrary-filesystem API and root-folder asset clutter. Archive/delete never silently deletes an export pinned by an unresolved message.

Keep CC UUIDs/revisions separate from Excalidraw's native IDs, versions and versionNonce. Human-created/imported elements can have non-UUID native IDs; maintain a stable adapter mapping including text, bindings, group IDs, frames and asset references. Agent-created items may use UUIDs directly. An API box with a label may map to two editor elements; commit their relationship atomically. Native payload validation retains supported round-trip fields, but clients cannot supply trusted server revisions or provenance.

Store creator and last editor plus timestamps per element. Agent author claims identify a coordinator/client and, where available, a validated CC process instance. This is attribution within CC's existing trusted-network boundary, not authenticated multi-user identity or a new permission system. Imports cannot spoof existing author records. Attribution never grants messaging or editing authority.

History records committed operations, not pointer samples. Checkpoint every 20 operations; initially retain the most recent 100 revision steps per board with a byte cap and enough checkpoint data to reconstruct them. Pinned exports retain their exact frozen scene/assets independently. History reads are paged; restoration generates a new revision with explicit conflict checks rather than rewinding other people's changes invisibly.

## Draft REST surface

All paths are under `/api/v1`. Maintain `docs/openapi.json` with implementation, not invented working routes in advance. Every mutation uses exact Origin, bounded JSON and an operation UUID/request digest; duplicate UUIDs return the recorded result, changed reuse is 409. Revisions and UUIDs follow existing ticket conventions.

| Route | Proposed behavior |
| --- | --- |
| GET /whiteboards; POST /whiteboards | List metadata; create named board with client UUID |
| GET /whiteboards/{id}; PATCH /whiteboards/{id}; DELETE /whiteboards/{id} | Scene+revision/readback; revision-checked metadata edit; logical deletion |
| POST /whiteboards/{id}/elements | Create semantic/native elements with UUIDs, optionally place a new graph automatically |
| PATCH or DELETE /whiteboards/{id}/elements/{elementId} | Checked element mutation/tombstone, including affected binding dependencies |
| POST /whiteboards/{id}/operations | Atomic batches for human gestures, graph edits, grouping, import and conditional undo |
| GET /whiteboards/{id}/changes?after=REV | Bounded revision-ordered deltas/tombstones; reset_required after compaction |
| GET /whiteboards/{id}/description | Human/agent-readable elements, labels, edges, groups/frames, positions, revisions and omissions |
| GET /whiteboards/{id}/history | Bounded committed-operation history |
| POST /whiteboards/{id}/assets | Bounded raster-image upload; return immutable content ID, not a path |
| POST /whiteboards/{id}/export | Freeze exact revision/scope/theme/scale into an immutable export job |
| GET /whiteboard-exports/{exportId}; GET /whiteboard-exports/{exportId}/{format} | Job status/manifests; PNG, SVG, native JSON or text bytes |

Every scene read includes normalized semantic fields plus validated native data/mapping so agents need not author editor internals. Text readback is complete for a bounded scene or explicitly paginated/labelled as truncated. Positions never substitute for stable IDs.

Example request intent (A/B/C are local aliases resolving to returned UUIDs):

```json
{
  "operation_id": "11111111-1111-4111-8111-111111111111",
  "layout": {"direction": "right", "placement": "new-region"},
  "nodes": [{"key":"A","kind":"box","label":"Browser"},
            {"key":"B","kind":"box","label":"Rust API"},
            {"key":"C","kind":"box","label":"SQLite"}],
  "edges": [{"from":"A","to":"B"},{"from":"B","to":"C"}]
}
```

Use a deterministic layered layout with conservative text sizes and explicit spacing. Cycles/disconnected nodes get stable placement; no layout claim implies crossing-free geometry. Default placement is a vacant region or new frame. Existing human-positioned elements move only when explicitly included with expected revisions. Mermaid import is a later convenience; the semantic graph request already solves the no-pixel authoring requirement.

## Shared editing, conflicts and undo

The Rust store is authoritative. Accept a stale overall scene revision if every affected element/dependency still has its expected revision; independent edits merge. Same-element edits, deleted references, changed locks, groups or newly changed binding dependencies return structured 409 conflicts with affected IDs/current revisions. Validate the full transaction and apply all or none, including bound text/arrows. No last-writer-wins whole-scene PUT.

Debounce gesture persistence (roughly 300 ms) and commit at pointer-up/text-edit completion. Retain the local dirty batch until acknowledged. During a gesture, integrate unrelated remote changes and defer changes touching edited IDs. On conflict preserve the local proposal and show review/reapply/duplicate choices; do not repeatedly retry against fresh revisions. Read-only changes polling at roughly one second while visible, slower when idle, stops when hidden. Agents see commits on their next GET; live cursors and CRDTs are out of v1.

Excalidraw's local undo stack must not revert someone else's work. Record acknowledged local operations and conditional inverses. Route undo/redo through checked element operations; apply incoming scene updates without capturing them as local history. If an inverse's touched elements changed remotely, block that undo for review. This integration is an early acceptance gate, not assumed solved by embedding the editor.

## Exports and renderer deployment

Freeze a requested scene revision and whole-board/frame/explicit-selection scope. Include child labels and relevant bound connectors, clip to requested scope, and remove references outside exported JSON. Return exact revision, included element IDs, theme/scale, content types, sizes, SHA-256 hashes and text readback in an immutable manifest. Never silently substitute the latest scene. SVG must be self-contained, have no scripts/foreignObject/network dependencies and be downloaded rather than injected as trusted app HTML. No full-scene payload hidden in a selected PNG/SVG. Selection scope must not leak other elements through metadata/assets.

Browser downloads can use the pinned editor export helpers. REST rendering cannot rely on a human browser being open: propose a backend-owned bounded renderer worker using the same pinned editor helpers, Node and sandboxed headless Chromium. Feed a frozen validated scene/assets over a private pipe; expose no new public port and block external requests. One worker/job at a time, bounded queue, time/memory/output limits; dispose failed workers. POST export returns 202 and job UUID; status/artifact GETs are read-only. JSON/text don't need Chromium; PNG/SVG jobs report unavailable if the renderer is absent, never pretend an export succeeded.

This adds explicit Node/Chromium runtime requirements for server image export. It is the principal deployment tradeoff requiring acceptance. CC control, persistence and transport remain Rust; there is no remote daemon. The prototype verifies browser export utilities, not the production pipe/worker/sandbox integration. Use the browser sandbox in deployment; the local test runner's existing no-sandbox setup is not the proposed security model.

Starting limits to validate: 2,000 elements and 2 MiB scene JSON per board excluding raster bytes, 4 MiB/16 megapixels per pasted image, 16 megapixels per raster export, 8 MiB per exported artifact, a small renderer queue and a 15-second render deadline. Add total asset/history quotas and explicit capacity errors. These are proposed defaults, not measurements or existing guarantees.

## Remote artifact delivery: second phase

Existing messaging is text-only; existing Files writes are UTF-8/conflict-checked. Neither is a safe binary attachment implementation. Do not route binary exports through the editor API, direct coordinator SSH/SCP, a generic upload destination, or terminal paste.

Add attachment preparation to the existing guarded message flow, taking immutable CC export IDs/format/digests only. A read-only preparation resolves the verified recipient's home, exact target/process/conversation and prospective managed path. Grants bind endpoint revision, process start identity, message UUID, export revision/scope/checksums and the complete composed text/path/fallback. No client-chosen source/destination path. The message JSON can reference the prepared attachment manifest rather than inline base64. Include all references/hashes in the idempotency digest; same UUID with different attachment content is 409.

Before remote IO, persist one intent in the existing outbox, pin exports, and store an attachment manifest/state. Distinguish attachment staging from terminal submission. Backend uses shared local/SSH/ProxyJump transport with strict host-key checks and bounded binary chunks/fixed helper operations. No new daemon, port or forwarded agent. Proposed remote location is the account's `~/.cache/command-center/attachments/<message-uuid>/whiteboard-<board-uuid>.png` plus manifest/text fallback. Resolve the absolute path during preparation and revalidate at copy time.

Use owned private directory descriptors, reject symlink/foreign-owner ancestors and traversal, exclusive new directories/files, bounded writes and no overwrite. Validate size/SHA-256 against the frozen export on the receiving machine and publish a completion manifest only after the complete bundle is verified. Existing same-UUID files are inspectable for recovery, never overwritten. Bind manifest to endpoint/process/conversation; revalidate before and after copy. Endpoint/process changes block delivery to replacement agents.

Only a verified attachment lets the normal FIFO outbox worker claim fresh provider/screen-bound native input. Persist the exact final delivery text first; include the target absolute path plus a short bounded plain-text board description, within the existing 12,000-byte message limit. Oversize intent is rejected for review, not silently truncated/split. The receipt proves submitted/Seen text and verified file placement; it does not claim the model opened or understood the image.

An uncertain copy is distinct from uncertain terminal input. Explicit Check attachment performs read-only manifest/hash recovery; no automatic file rewrite, message replay or text-only substitute. After verified staging, native submission retains current one-use/process/screen guards and uncertain receipts. A missing renderer, failed transfer or checksum mismatch blocks the message honestly. Cancellation applies before input claim; never cancel Submitting/uncertain input by deleting an attachment.

Default attachment expiry proposal: 7 days after a resolved/archived message, never while queued/submitting/submitted/uncertain/blocked. UI/receipt exposes expiry. Cleanup uses stored managed manifests and unchanged endpoint identity only, skips unavailable/changed hosts, and never recursively follows arbitrary paths. Storage pressure blocks new transfers rather than deleting unresolved evidence. Bounded orphan staging cleanup requires proof that no live receipt references it.

Authority remains an explicit human send request or a scoped coordination task. Drawing, exporting, ticket state, actor labels or possession of an export ID do not authorize delivery. Prefer a board link plus a short description when the recipient can read CC; attach one frozen image when useful, not repeated large images. Serve metadata and artifacts through CC's current trusted origins without new public sharing links.

## Phases and acceptance gates

1. **Shared Whiteboard v1:** lazy editor, named boards/ticket links, safe images/import, durable elements/history, semantic create/layout/readback, attribution, checked element merges and undo, visible polling, mobile basics, UI downloads and REST export worker, OpenAPI and cc-whiteboard instructions. No remote transfers. Report at the API/editor/export boundaries; no service-disrupting deploy without human approval.
2. **Guarded attachments:** durable export references/grants and outbox states, managed local/SSH copy/verification/expiry, message UI/API manifests and cc-message/cc-coordinate documentation. Ship only after uncertain-transfer and changed-recipient tests. No live sends as part of development.
3. **Optional follow-ups:** Mermaid conversion, live collaborator cursors, richer history/restore UI, more layout strategies, additional authenticated users. None are prerequisites for the initial shared canvas.

Rust tests cover isolation, revisions/idempotency, deletes/binding dependency conflicts, conditional undo/history, export scope/no-leak/quotas and restarts. Playwright covers human/agent concurrent edits, draft/conflict preservation, all baseline tools, theme/lazy loading, safe import/paste/export, touch gestures, viewport/keyboard and zero compact terminal traffic. Renderer tests compare self-contained SVG/PNG dimensions/labels/bindings with frozen JSON/text. Attachment tests use isolated local and SSH/ProxyJump hosts for traversal/symlink/overwrite/checksum/expiry/process-replacement/crash cases and duplicate UUIDs. Verify Claude/Codex/pi image-opening using disposable fixture agents or separately authorized test sessions; do not prompt existing work agents merely to prove this. Actual iPhone testing remains an explicit coverage item.

Await human approval of the engine/runtime tradeoff and Phase 1 before creating implementation tasks or altering runtime code/dependencies. Phase 2 remains a separate check-in with the concrete attachment contract before implementation; the full CC-46 ticket is not complete at the end of Phase 1.
