# Whiteboard red/browser rendering fix

[Task0065](../tasks/done/0065-whiteboard-browser-color-fallback.md), [bug0031](../bugs/fixed/0031-whiteboard-red-stale-render.md): fresh client renders the intact reported revision7 in all24 themes; several ANSI red slots are non-red. Replaying the pre-palette bundle reproduces blank canvas/five swatches/unsupported scene, without uncaught exception. This establishes the stale-client failure mode, not the human’s exact browser cache state.

Static fix published without restart: semantic diagram red in remapped themes, ink fallback for unknown/missing paint without stored-data normalization, per-object exception placeholders/warnings, safe swatches when CSS tokens are empty. Actual live scene renders32 objects in all24 themes, visibly red, no page errors/writes/terminal sockets; deep scene comparison unchanged. User must reload an already-open old client. No live drawing edits or agent actions.

Rust75, HTTP exports11, OpenAPI, hue/contrast/all24, pure shared-paint invariants, final palette browser9 plus existing export/shared6, builds/format/Clippy pass. Private screenshots/evidence in ignored .local/. Backend no-store HTML and embedded resolver changes staged; prepared restart script not executed pending human approval. No commit/push. Other uncommitted tasks preserved.

Subsequently approved/deployed; see [deployment note](2026-11-12-distinct-whiteboard-palette-deployed.md).
