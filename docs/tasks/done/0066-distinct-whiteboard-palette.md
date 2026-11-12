# Task 0066: Distinct semantic drawing palette

Owner: CC dev
Claimed: 2026-11-12
State: done

Fix near-duplicate/hue-misnamed swatches across themes. Nine named drawing colors use deliberate light/dark semantic hues, adjusted for theme contrast and matching soft fills. Keep API names; ink/accent remain themed and explicitly separated/labeled in UI (some themes intentionally make them identical). Test hue, contrast and pairwise perceptual separation across all24 themes, browser swatches/export parity, inspect screenshots. No board data edits or disruptive deployment without approval. Preserve task0065 pending backend header change; no commit/push.

## Implementation

Generator now uses deliberate semantic light/dark bases for red/orange/yellow/green/teal/blue/purple/magenta/gray, adjusting for each theme background/soft-fill contrast. Dedicated --cc-wb-* CSS and generated renderer palettes stay aligned. General UI/terminal tokens unchanged. Ink/accent retain theme values and are shown as labeled Theme chips, separate from the nine-color grid, because some themes intentionally make them identical. Existing names/element data unchanged; misleading inherited drawing hues intentionally change appearance. Soft fills follow actual named hues; sticky defaults and defensive renderer behavior retained.

Validation: generated palette test checks all24 themes for semantic hue ranges/saturation (neutral gray), >=4.5 background/own-fill contrast and >=0.08 pairwise OKLab distance across all nine names. Minimum observed separation0.0832 (catppuccin-latte, teal/gray); no appearance-preservation assertion for formerly wrong legacy hues. Shared paint-fallback Node invariants and OpenAPI contract pass. Rust20 focused Whiteboard tests (including actual PNG/SVG colors/fills), Clippy all-targets/-D warnings, format, release and frontend TypeScript/Vite build pass. Existing Vite chunk advisories only. Playwright palette/export12 pass, including desktop/mobile persistence and full canonical export parity; new distinct-swatch case covers Hackerman, default, light, Kanagawa duplicate theme colors and monochrome White. Synthetic screenshots inspected.

Staged browser assets previewed on the actual requested diagram with read-only routes:32 objects in Hackerman/default/light, zero page errors/writes. Full and picker screenshots private under ignored `.local/reviews/distinct-whiteboard-palette/`; board data not changed. Picker now has clearly separated red/orange/yellow/green/teal, then blue/purple/magenta/gray, plus labeled theme controls.

## Release

Staged, not deployed/committed/pushed. Private `/tmp/cc-deploy-whiteboard-distinct-palette.py` prepared/syntax checked, preserving listeners/configuration/panes and backups/in-flight guards. UI and backend must deploy together because canonical export colors changed as well. Includes already-pending task0065 no-store HTML/shared resolver build; ask human before service restart. No live diagram edits, agent actions or ticket mutations.

## Approved deployment — 2026-11-12

Human approved joint deployment. Four configured access paths healthy; listeners/configuration and canonical local tmux pane/PID inventory unchanged. Live read-only diagram check renders32 objects, nine distinct semantic swatches, labeled Theme ink/accent and no-store HTML, with zero page errors/writes/terminal sockets. Private backups and screenshot evidence retained under ignored `.local/`. No scene edits, agent messages or commit/push.
