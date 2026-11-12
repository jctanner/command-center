# Task 0064: CC-55 Whiteboard named palette and soft fills

Owner: CC dev
Claimed: 2026-11-12
State: done

Add red first and fuller named palette: ink/accent/blue/magenta/yellow retained; red/orange/green/teal/purple/gray added. Named generated theme tokens, contrast-check new tokens on backgrounds/own soft tints; preserve legacy five/raw board appearance. Optional fill soft/none on fillable shapes, omission preserves old behavior/sticky default. Canvas/API/apply/PATCH/OpenAPI/shared server renderer/JSON/text/docs and meaningful Rust/Playwright tests. Preserve uncommitted coordinator restart task0063. No live board recolor, disruptive deploy/restart, commit/push authorized.

## Implementation and compatibility

Rust Drawing accepts optional fill (none/soft) only for rectangle/ellipse/diamond/sticky, validates eleven named stroke tokens in all element/apply/PATCH paths, and describes color/fill in text readback/exports. None/omission preserves old transparent shapes and old sticky yellow; explicit none makes stickies transparent. Native JSON keeps semantic names. OpenAPI updated with full enums and optional nullable fill. Generic cc_whiteboard.py already passes these fields; no CLI changes needed. No live board recolor performed.

Theme generator now emits readable teal/purple/gray plus their soft tokens and generated `whiteboard-palettes.json`/`--cc-wb-*` CSS. Existing five drawing colors intentionally retain their raw pinned values to avoid recoloring old boards; new drawing colors match semantic UI tokens. All24 themes have matching browser/CSS/server values, with new strokes checked >=4.5:1 on background and their own soft tint. Sticky default values remain the prior mode-specific yellow. Shared geometry handles filled paths identically for browser, server SVG and PNG. The backend still exports canonical light/dark, while browser follows selected named theme, as before.

Canvas palette wraps eleven accessible named swatches; inspector adds Shape fill Default/None/Soft tint. Selection edits and default new-shape style use existing revisioned sync, conditional undo signatures and draft recovery. Text/arrow/freehand/image cannot receive fill. Mobile settings remain collapsible. No new dependency. Docs/API/gap audit updated; no unrelated CC-55 features or coordinator task0063 changes altered.

## Validation — 2026-11-12

- `cargo fmt --check`, Clippy all-targets/-D warnings, release build: pass.
- `cargo test --lib --quiet`: 75 pass; new validation tests cover all11 names, fills, invalid raw CSS/hex/URLs, nonfillable kinds and omitted sticky serialization; render tests assert actual soft-fill PNG pixels and SVG strokes for all11 in both themes, preserving legacy sticky fill.
- `python3 -B tests/test_whiteboard_palette.py`: pass across all24 generated palettes; verifies old-five exact values and new-color contrast on background/own tint. `tests/test_openapi.py Contract`: pass.
- Existing Whiteboard HTTP suites: API5, exports11, images8 pass (inherited cases overlap).
- TypeScript/Vite build passes; existing chunk advisories only.
- Disposable Playwright whiteboard-palette/export/shared/images:16 pass. New5 cases cover all swatches on desktop/mobile, red soft-tint edit/save/reload/clear, both export themes' browser/SVG parity, JSON/text names and invalid patches preserving revisions. Existing geometry/raster, shared/conflict/recovery and image regressions pass.
- Existing all-pinned-palettes browser test:1 pass, preserving text contrast/theme switching/persistence/cross-tab behavior.
- Inspected synthetic light desktop/dark mobile screenshots; swatches and fill control fit. `git diff --check`: pass.

## Release handoff

Implemented/tested release and static assets staged, not deployed/committed/pushed. Private `/tmp/cc-deploy-whiteboard-palette.py` prepared/syntax checked only; preserves listeners/configuration/pane processes, checks in-flight actions/exports, backs up runtime/SQLite/assets and verifies served red/fill contract after approved restart. Human approval is required before disruptive backend deployment. No live boards modified; coordinator can PATCH changes:{color:"red",fill:"soft"} after deployment with ordinary current revision/dependency guards. Exact final color list: ink, accent, blue, magenta, yellow, red, orange, green, teal, purple, gray; purple is canonical, not violet.

## Deployment — 2026-11-12

Human approved deployment. Prepared restart script executed: four configured access paths healthy, configuration/listeners preserved, canonical local tmux pane/PID inventory unchanged, served red/fill contract verified. Read-only live browser confirms eleven exact named swatches and Default/None/Soft tint options with zero page errors, API writes or terminal sockets. No live board recolored. Existing tests remain the functional color/fill validation. No commit/push.
