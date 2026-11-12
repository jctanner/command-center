# ADR-0004: Board-owned normalized raster blobs

Status: accepted for CC-55 item 4 implementation
Date: 2026-11-12
Related: [task 0059](../tasks/done/0059-whiteboard-images.md), [export renderer](0003-bounded-whiteboard-export-renderer.md).

Store normalized PNG BLOBs in the existing private SQLite database, keyed by board and SHA-256. Semantic image elements keep hash and intrinsic dimensions separately from position/display dimensions. Existing scene/element revisions, actor attribution, history and operation UUIDs remain authoritative. A revision-checked raw upload does not itself alter the scene. Reference creation must prove that the descriptor exactly matches a blob on that board. Deduplicate within a board, avoiding a global blob-authorization/reference-count framework.

Use the Rust image crate's PNG/JPEG/GIF/WebP decoders with explicit sniffing, 4 MiB input/output, 8 MP/8192-side dimensions, bounded concurrent off-executor decoding and decoder allocation limits. Re-encode RGBA PNG, stripping metadata and flattening animation to the first frame. No SVG or source URL uploads. Keep original formats, EXIF orientation handling and coordinator upload convenience commands outside this slice. The crate uses MIT/Apache-2.0 licensing per installed package metadata.

Preserve current and retained-history references; collect unreferenced uploads after 24 hours on image/scene operations. Deleting a board removes its blob bytes immediately, leaving soft-deleted identity/history metadata. Quotas bound live/history/unplaced storage: board16 MiB/32 MP, global64 MiB. Frozen exports already contain image bytes, independently of later source deletion.

Browser raster URLs are same-origin board reads converted into bounded board-local object URLs; SVG redraws reuse those bytes. No image bytes are persisted in browser drafts. The existing isolated Rust export worker receives only selected stored PNGs, verifies hashes/intrinsic dimensions, and allows only those exact PNGs in resvg's data resolver. String/network/filesystem resolvers remain disabled. Enable resvg raster-images, raise its input envelope to 12 MiB, keep 8 MiB output and all existing CPU/memory/output-pixel deadlines. Image sources in one export are capped at 4 MiB/16 MP aggregate; selection is the recovery for larger boards. Native JSON/text describe references rather than embedding raster bytes in every revision. No new image-serving process or external asset service.
