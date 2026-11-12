# Task 0065: CC-55 browser red/blank canvas regression

Owner: CC dev
Claimed: 2026-11-12
State: done

Investigate reported live32-element board revision7 read-only: red swatch absent in human theme, browser blank while server PNG correct. Inspect deployed assets, console, scene/schema and theme mappings across themes; ask selected theme if unavailable. Add safe ink color fallback and prevent a single bad color/element blanking the scene without mutating stored drawing. Regression coverage for root cause and fallbacks. No live element changes, disruptive deployment/restart or commit/push without request; preserve uncommitted tasks0063/0064.

## Reproduction and findings

Read-only fresh production browser renders all32 elements of the reported revision7 in all24 themes, zero console errors. Several themes map terminal ANSI red to green/blue/purple/gray, confirming the misleading swatch. Replaying the retained pre-palette browser bundle against the unchanged live scene reproduces zero drawn objects, five swatches and Invalid or oversized local scene status; it has no uncaught page exception. This explains a reproducible stale-client failure mode but does not prove the human's exact loaded bundle; selected-theme question pending, so all24 themes checked. Private scene/browser evidence stays in ignored `.local/reviews/whiteboard-red-bug/`, no raw diagram data in tracked notes.

## Fix

Generator checks red hue/saturation and uses contrast-checked semantic red only when the native terminal slot is not red. Existing legacy five, properly red theme values, unrelated terminal/general UI tokens and default sticky fill stay unchanged. Whiteboard-specific stroke/soft tokens and shared renderer JSON remain aligned.

Shared pure paint resolver accepts only trusted palette hex and supported named colors, otherwise ink/ink-soft with mode-safe fallback; no arbitrary scene CSS. Browser accepts bounded unknown paint metadata for read-only display without replacing the whole scene or normalizing saved data. REST remains strict. Each object renders into a fragment with isolated error handling and ink placeholder/warning on failure; a bad object cannot clear the rest. Unknown colors receive a visible fallback warning. Added swatch titles and no-store on same-origin Whiteboard HTML to refresh stale entrypoints safely; no forced reload or loss of local drafts.

## Validation — 2026-11-12

- Format, Clippy all-targets/-D warnings, release and TypeScript/Vite builds pass (existing chunk advisories).
- Rust75 library tests pass; server export HTTP11 pass; OpenAPI contract pass.
- Generated palette test checks all24 themes for red hue/saturation and new-color background/soft contrast, plus unchanged original five.
- `node web/tests/whiteboard-render-core.test.mjs` passes malformed/missing palette, invalid CSS and unknown-paint fallback invariants.
- Disposable Playwright palette/export/shared run:13 passed, one test assertion corrected to inspect the outline instead of roughjs's ordinary stroke-none fill path; corrected unknown-paint test passes separately. All14 unique cases validated, including semantic-red swatches in seven formerly misleading themes, no-store/SAMEORIGIN HTML, unknown paint retaining both objects/actual stored values with no writes, isolated object failure/recovery, existing palette editing and export parity/shared conflict/recovery.
- Staged client renders the actual private revision7 snapshot read-only via a temporary backend:32 objects across all24 themes, zero page errors or API writes. Synthetic renderer and actual snapshot screenshot inspected. No live scene mutations or export creation.

## Release handoff

Implementation staged, not deployed or committed/pushed. Backend entrypoint-header and embedded palette/renderer changes require approved restart alongside frontend. Private `/tmp/cc-deploy-whiteboard-red-fallback.py` prepared/syntax checked, preserving current listeners/config/panes, checking in-flight actions and verifying no-store entrypoint after deployment; human approval needed. Reload Whiteboard after deployment to replace already-loaded old bundles. Preserve all uncommitted tasks0063/0064 work.

## Static publication and final validation

Browser fix published without service restart, with private HTML backups and current hashed assets retained. GET-only live check of the requested board now confirms32 objects, visibly red swatch across all24 themes, zero page errors/writes/terminal sockets. Deep comparison against the first private scene snapshot confirms revision7 and all scene data unchanged. A running pre-palette page still needs Reload to load these published modules; no user tab or draft was forcibly refreshed.

Final focused palette browser suite9 passes, including missing/empty CSS paint tokens using generated-palette fallback. Previous export/shared regressions6 pass:15 unique browser cases overall. Node paint invariants and all24 hue/contrast tests pass; Rust75, server HTTP exports11, format/Clippy/release/frontend build and OpenAPI pass. Missing CSS swatches now fall back to generated palette paint as well as canvas ink fallback. Normal roughjs fill paths may have stroke none; outline assertions account for that.

Remaining: approved backend restart to publish no-store HTML policy and embedded shared-paint changes. Private restart script prepared, not executed; coordinator restart and palette feature work remains uncommitted. No live board edit, messages, commit/push.

## Approved deployment — 2026-11-12

Human approved joint deployment. Four configured access paths healthy; listeners/configuration and canonical local tmux pane/PID inventory unchanged. Live read-only diagram check renders32 objects, nine distinct semantic swatches, labeled Theme ink/accent and no-store HTML, with zero page errors/writes/terminal sockets. Private backups and screenshot evidence retained under ignored `.local/`. No scene edits, agent messages or commit/push.
