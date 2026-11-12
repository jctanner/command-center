# Task 0059: CC-55 item 4 — Whiteboard pasted/dropped images

Owner: CC dev
Claimed: 2026-11-12
State: done

Only clipboard/file-drop images: board-scoped content-addressed normalized PNG blobs; <=4 MiB input/output and <=8 MP; sniff PNG/JPEG/GIF/WebP, first frame, strip metadata. Upload against board revision, place through ordinary element apply with trusted blob dimensions. Stored-reference-only browser/server rendering, normal revisions/history/attribution/delete, aspect-preserving resize. Retain live/history references, expire abandoned uploads, clean board deletion. OpenAPI/docs/gap audit and Rust/Playwright evidence required. No deployment/restart, commit/push, live board edits or other CC-55 items authorized.

## Implementation

Added board-scoped `whiteboard_images` SQLite blobs, SHA-256/dimension descriptors and revision-checked raw upload/read endpoints. PNG/JPEG/GIF/WebP are sniffed and normalized to metadata-free RGBA PNG; SVG/URLs/paths are rejected. Byte/dimension/pixel/board/global quotas and bounded off-executor decode concurrency apply. The decode slot remains owned by the blocking task on HTTP cancellation. Scene apply/patch verifies board ownership and intrinsic dimensions. Ordinary element revisions, history, attribution, undo/redo and delete are reused. History references retain blobs; unreferenced uploads expire opportunistically after 24h; logical board deletion removes blobs immediately.

Shared canvas supports native clipboard paste and file drop, select/move/resize with default aspect preservation, duplicate, polling sync and Keep as new board (copying owned blobs). Text-editor paste stays native; URL drops are never fetched. Board-local bounded object-URL cache avoids no-store fetches on every redraw, with four concurrent GETs. No browser-persisted image bytes. Browser/server SVG/PNG embed normalized images; JSON/text retain semantic image references/dimensions/attribution. Server worker verifies selected hash/dimension-qualified PNGs only, has no external resolver, and keeps bounded output/time/memory. Worker input envelope is 12 MiB and export image sources capped at4 MiB/16 MP aggregate. SVG CSP permits image data only.

See [ADR-0004](../../decisions/0004-whiteboard-raster-blobs.md) and [API reference](../../reference/whiteboard-api.md). Updated served OpenAPI and the gap audit. Optional coordinator upload helper is not added; documented REST permits authorized semantic image placement. No other CC-55 backlog items implemented.

## Validation — 2026-11-12

- `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo build --release --quiet`: pass.
- `cargo test --lib --quiet`: 73 pass, including format sniff/normalization, animated GIF first frame, original and normalized byte limits, pixel limits, board scope/revisions, history-aware GC, image element attribution/conflicts, renderer actual PNG pixels and tampered/external source rejection.
- `python3 -B tests/test_whiteboard_images.py`: 8 pass (includes inherited five core API regressions). New HTTP cases cover MIME spoofing/metadata removal/deduplication, limits/Origin/revision, scene patch/conflicts/attribution, PNG/SVG/JSON/text, selection source isolation, expired orphan cleanup and board deletion.
- `python3 -B tests/test_whiteboard_exports.py`: 11 pass, including existing export selection/region/expiry/download behavior and inherited API cases.
- `python3 -B tests/test_openapi.py Contract`: pass, including route inventory with the image module and extended scene schemas.
- `npm --prefix web run build -- --outDir dist-next`: TypeScript/Vite pass (existing chunk advisories only).
- Disposable Playwright regression run for whiteboard-images/shared/export/delete: 16 pass. After final cache/URL ownership changes, four focused image tests pass plus the fifth text-editor/URL-drop case passes separately after fitting its remote fixture shape clear of the properties overlay: 17 unique browser cases validated overall. Covers real Chromium ClipboardItem + Ctrl+V, desktop/mobile synthetic file drop, resize ratio, move, sync, undo/redo, reload, image draft copying, single-fetch object-URL reuse, text paste ownership and no remote URL fetches. Actual iPhone clipboard untested.
- Inspected synthetic mobile screenshot: pasted/dropped raster and resize handles fit the canvas; no terminal traffic. `git diff --check`: pass.

## Release handoff

Human approved deployment on 2026-11-12. Implementation deployed, not committed or pushed. Private `/tmp/cc-deploy-whiteboard-images.py` executed after human approval: backups, preserve argv/environment/listeners/tmux pane PIDs, reject in-flight outbox/question/export operations, check served image routes and health. Approved restart succeeded: all four configured access paths healthy; configuration/listeners and canonical local tmux pane/PID inventory unchanged. Served image upload/read, question, export and attachment contract paths verified. Read-only desktop/mobile browser checks show the canvas and current image upload module, zero page errors, browser writes or terminal sockets. Private screenshots/checks and runtime/database backups stay under ignored `.local/`. No live image paste/drop was performed; functional validation uses the disposable tests above. No live whiteboard writes, agent actions, remote image/harness checks or live ticket changes performed. Image metadata orientation is stripped rather than applied; animation flattened; native JSON carries references rather than a standalone raster archive. Other CC-55 work stays backlog.
