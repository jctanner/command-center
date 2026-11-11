# ADR-0003: Bounded shared-geometry Whiteboard exports

Status: Implemented under the human's server-export request; deployment not yet approved.
Date: 2026-11-10
Related: CC-46, task 0052, [attachment proposal](../plans/0003-whiteboard-attachments.md).

## Decision and evidence

Render server images using the exact pinned roughjs 4.6.6 generator, evaluated by embedded rquickjs with no host IO/module loader bindings, plus the same tracked geometry/wrapping source used by the browser. Rust owns freezing, validation, artifact storage and HTTP. resvg rasterizes the self-contained SVG. A short-lived copy of the CC executable runs the private render protocol before service/runtime initialization, with one global slot, bounded pipes, kill-on-drop/hard deadline and Unix CPU/address-space limits. Durable preparation/rendering continues after an HTTP disconnect and restart marks interrupted jobs failed without retry.

This adds no Node/Chromium service or required remote daemon. A separate Rust shape approximation was not chosen because it would diverge from existing seeded hand-drawn paths. Browser/server light/dark path/text comparisons and PNG raster tolerance tests pass, alongside existing editing/touch tests. One shared unmodified OFL Liberation Sans font avoids host-installed font drift for supported glyphs; unsupported font coverage remains a limitation. No external image/font resolution is permitted in the worker.

The released generator source is vendored with version/hash/notices, not loaded from node_modules during Rust deployment. Browser assets contain the shared renderer and a 410,712-byte font (211,540 bytes independently gzipped). Server binary is about 21 MB total in this build; no incremental binary-size claim was measured. One six-box, 2× synthetic render on Linux x86_64 took 0.03 seconds with 26,060 KiB peak RSS, excluding HTTP/DB overhead. These are observations, not worst-case budgets.

## Contract and limits

POST export freezes exact scene/region revisions and publishes PNG/SVG/native JSON/text with hashes and download URLs. Selection exports omit excluded data and detach/freeze external arrow references; named scopes are API records until GUI frame/group tools ship. Rasterization is at most 8 megapixels/8192 pixels per side; per-artifact 8 MiB, store 64 MiB, and 24-hour expiry. Export UUID/digest receipts survive expiry; no ID reuse or automatic re-rendering. Local helper downloads are private, no-follow, checksum checked and no-overwrite. No transfers or provider messages are part of rendering.

API-level frame/group metadata is the small prerequisite for scoped export, not a claim that GUI group/frame tools are complete. Future attachments must add durable export pins before extending retention for pending messages. That sensitive implementation waits for human approval of Plan 0003.

References: [rquickjs runtime limits](https://docs.rs/rquickjs/latest/rquickjs/struct.Runtime.html), [resvg](https://docs.rs/resvg/latest/resvg/), [roughjs](https://github.com/rough-stuff/rough). Exact installed versions/features/licenses were checked through primary package metadata and local crate sources.
