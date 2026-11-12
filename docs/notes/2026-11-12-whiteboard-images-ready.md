# Whiteboard image paste/drop ready

[Task 0059](../tasks/done/0059-whiteboard-images.md) implements only CC-55 item4. Board-owned normalized raster blobs, native clipboard/file-drop placement, ordinary revisions/history/attribution/sync, aspect-preserving resize and stored-source-only PNG/SVG exports are ready locally. JSON/text describe images without duplicating raster bytes in scene history. See [API](../reference/whiteboard-api.md) and [ADR-0004](../decisions/0004-whiteboard-raster-blobs.md).

Validation: format/Clippy/release/frontend build pass; 73 Rust library tests, eight image HTTP tests, eleven existing export/API tests, OpenAPI contract and 17 unique browser cases validated (16-case regression pass plus final image/ownership checks). Synthetic mobile screenshot inspected. Actual iPhone clipboard and real remote Claude/pi image checks are not performed. Existing Vite chunk advisories remain.

No deploy, commit/push, live drawing mutations or agent actions. Prepared restart script remains private and unexecuted pending human approval. Other CC-55 items remain backlog. Quotas are4 MiB/8 MP per input,16 MiB/32 MP per board,64 MiB global; export sources4 MiB/16 MP aggregate. Re-encoding strips metadata and keeps first animation frame; orientation is not reapplied. History-aware opportunistic GC retains undo references; board deletion removes its blob bytes.

Deployment subsequently approved/completed; see [deployment note](2026-11-12-whiteboard-images-deployed.md).
