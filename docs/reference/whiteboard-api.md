# Shared Whiteboard API

The lightweight canvas lives at `#/whiteboard` and `/whiteboard.html`. The original `/whiteboard-prototype.html` remains browser-only. The main client mounts the shared editor lazily in a same-origin frame; only that HTML endpoint permits same-origin embedding. Other pages retain DENY. No terminal viewer or resize is involved in Whiteboard.

Rust owns scenes in new tables in the existing private `.board.sqlite3`. Existing SQLite WAL/FULL commits and off-executor access apply. Each scene has a UUID, named metadata, optional ticket UUID, monotonic scene revision and independent metadata revision. Each element has a UUID, revision, semantic drawing data, creator/last-editor labels and timestamp. Attribution is not authenticated multi-user identity. No React/Excalidraw/runtime renderer dependency.

## Coordinator operations

Use the served OpenAPI contract and `coordinator/tools/cc_whiteboard.py`. All mutations require the exact configured Origin; the helper supports loopback HTTP or trusted HTTPS without redirects/credential URLs. It never retries writes. Routes below are under `/api/v1`.

| Operation | Route |
| --- | --- |
| List/create | GET/POST `/whiteboards` |
| Scene/read, rename/link, logical delete | GET/PATCH/DELETE `/whiteboards/{id}` |
| Atomic changes | POST `/whiteboards/{id}/operations` |
| Create-only batch | POST `/whiteboards/{id}/elements` |
| Patch/delete one | PATCH/DELETE `/whiteboards/{id}/elements/{element}` |
| Graph placement without pixels | POST `/whiteboards/{id}/graph` |
| Read-only write recovery | GET `/whiteboards/{id}/operations/{operation}` |
| Text readback; recent drawing history | GET `/whiteboards/{id}/description`, `/history` |
| Legacy native JSON and description download | GET `/whiteboards/{id}/export` |
| Freeze/render a scoped export | POST `/whiteboards/{id}/export` |
| Export status and immutable bytes | GET `/whiteboard-exports/{id}`, `/{format}` |
| Upload/read board raster blobs | POST `/whiteboards/{id}/images?revision=SCENE_REV`, GET `/whiteboards/{id}/images/{HASH}` |
| Named API frame/group scopes | GET/POST `/whiteboards/{id}/regions` |

Create: `{id:UUID,name:"Design",ticket:null}`. Metadata PATCH: `{revision:METADATA_REV,name:"Design",ticket:EXISTING_TICKET_UUID_OR_NULL}`. Always retain ticket when renaming unless unlinking is intended. Delete uses the exact scene `{revision:NUMBER}` and retains stored identity/history; it never controls agents or tickets. In the editor, **Delete whiteboard** beside Rename confirms the selected board name, with Cancel focused. Finish saving/recovering local edits first. A concurrent edit blocks deletion until the server version is reviewed; lost responses are checked read-only and never automatically retried. Successful deletion selects another board or shows the empty state. **Delete selected** remains an object action.

For a new graph save this JSON intent with real UUIDs once, then call `draw --board UUID --input FILE`:

```json
{
  "operation_id":"11111111-1111-4111-8111-111111111111",
  "actor":"CC coordinator",
  "direction":"right",
  "nodes":[
    {"id":"22222222-2222-4222-8222-222222222222","label":"Browser"},
    {"id":"33333333-3333-4333-8333-333333333333","label":"Rust API"}
  ],
  "edges":[{"id":"44444444-4444-4444-8444-444444444444","from":"22222222-2222-4222-8222-222222222222","to":"33333333-3333-4333-8333-333333333333"}]
}
```

Graph nodes are rectangle/ellipse/diamond/sticky, default rectangle; 1–40 nodes, at most 80 edges and direction right/down. Order is the provided node order; this simple layout does not optimize crossings or move existing elements. All graph references are within the new graph. Text readback includes IDs, labels, shape kinds, coordinates/sizes, connections and revision/author metadata. Current full scene is bounded, not silently truncated.

For edits, `apply` accepts `{operation_id,actor,upserts:[{id,expected_revision,element:DRAWING}],deletes:[{id,revision}],dependencies:{ID:REV}}`. A drawing contains kind, x/y/w/h, text, color (ink/accent/blue/magenta/yellow/red/orange/green/teal/purple/gray), clean, seed and optional fill/from/to/points/image. Use `expected_revision:null` only for a genuinely new UUID. PATCH single uses `{operation_id,actor,revision,changes:{text:"New label"},dependencies:{...}}`. Unknown fields and caller-supplied server metadata are rejected.

Only affected elements/dependencies need matching revisions. A stale overall scene revision does not block independent edits. For each changed existing element, include its observed revision; add the revisions of its bound endpoints and every arrow referencing a changed/deleted shape, plus those arrows' endpoints. Newly supplied arrow endpoints also need revisions when already present. Validate all or none. Shape deletion must detach/delete its arrows in the same batch; no surprise cascades. Deleted UUIDs cannot be reused as new creates; explicit restore requires the retained last-active revision. Binding validation still applies to restores. A successful duplicate operation returns the current scene without reapplying; the compact receipt retains the original committed revision. Same operation UUID/different intent is 409.

A human drawing request supplies edit authority; a scene read, actor label or linked ticket does not. Keep a private intent before IO. On 409 keep the draft and reconcile exact objects rather than substituting fresh revisions. On timeout/lost response check the same operation UUID, then read current scene; no automatic resend. Creating a board uses a retained board UUID, not an operation token. A 404 receipt only proves no commit was observed at that time.

## Browser sync and limits

The editor commits completed gestures/text edits after a short debounce. Visible clients subscribe to `GET /api/v1/whiteboards/events` (SSE). Coalesced `whiteboards` events invalidate the catalog and selected scene after successful committed writes; REST remains authoritative. The stream carries only a backend-lifetime UUID (`epoch`) and change counter (`sequence`), never drawing content. Every connection/reconnection sends an initial invalidation, so missed changes reconcile without a durable replay log. Hidden workspaces disconnect and reconcile on return. A healthy stream needs no routine scene polling; unavailable streams reconnect and use a bounded 15-second fallback check. At most 32 streams are admitted; proxies should honor `X-Accel-Buffering: no`. The UI shows reconnecting, editing-deferred and draft-review states. Agent-created boards, renames and deletes update without reload; clean deleted selections move to another board, while local drafts and uncertain receipts are preserved for explicit recovery. Unrelated changes merge while local changes are retained. Conflicts retain the local draft, with explicit server-version/new-copy choices. Uncertain saves retain an operation receipt and offer read-only checking. Per-tab draft/receipt namespaces prevent ordinary tabs from overwriting one another's pending edit records. Conditional undo/redo changes only locally touched objects and refuses incompatible newer content.

Starting bounds: 100 boards, 300 elements/board, 1 MiB serialized scene, 2 MiB write bodies, 1,500 freehand points/element and 4,800 UTF-8 bytes of text. Geometry is finite within ±100,000. Total scenes are capped at 16 MiB, recent snapshots at 32 MiB, and retained operation/element identity counts at 100,000 each. At most 100 recent drawing snapshots are listed, subject to global history pruning. Operation receipts retain hashes/revisions, not a second full transcript/scene history. Metadata edits are not drawing snapshots. Capacity failures preserve old state.

SVG/PNG/JSON can be downloaded from the browser. Server-rendered scoped exports are described below. Clipboard/drop images are implemented below; imports and richer editing remain later work. Managed PNG attachments are implemented separately; see coordinator messaging, and discover the served API before use.

## Frozen server exports

POST `/whiteboards/{id}/export` with `{id:EXPORT_UUID,revision:SCENE_REV,scope:{kind:"board"},scale:1,theme:"dark"}`. Scale is .25–4; theme light/dark uses the corresponding built-in CC palette. Selection scope is `{kind:"selection",elements:[UUID,...]}`. Frame/group scopes are `{kind:"frame"|"group",id:REGION_UUID,revision:REGION_REV}`. Scene and region revisions must match the observations. Exported JSON/text/SVG include only selected members. An arrow referencing excluded shapes gets frozen absolute endpoints with those bindings removed; excluded labels/IDs/ticket references are not embedded. Selection does not implicitly include other connected shapes. Frames clip to their explicit bounds and refuse export if member geometry moved outside the frame.

Named scopes are API-level records for now. POST `/regions` with `{id,scene_revision,name,kind,elements,bounds}`; omit/null revision on create and use current region revision on edits. Frames require positive finite x/y/w/h bounds; groups omit/null bounds. GET `/regions` lists up to 100 scopes. This does not implement GUI group/frame editing or move scene elements.

The returned manifest has state rendering/ready/failed/expired, source revision/scope, included element IDs, bounds, theme/scale, dimensions and per-format URL/size/MIME/SHA-256. Ready `artifacts` contains png, svg, json and text. Download through the returned same-origin `/api/v1/whiteboard-exports/{UUID}/{format}` URLs. Native JSON is type cc-whiteboard-export and includes the scoped scene/description. Legacy GET export remains unchanged. Artifacts are no-store attachments with restrictive SVG CSP; SVG is self-contained with the shared font when labels exist, not hidden full-scene metadata or remote resources. Browser local-draft JSON remains distinct from a frozen committed export.

One resource-limited Rust subprocess embeds the exact pinned roughjs generator and shared browser geometry code; resvg rasterizes its SVG. No Node/Chromium service, JS host filesystem/network bindings, system fonts or external resource resolution. One bundled Liberation Sans font gives consistent supported glyphs and label placement; unsupported glyph coverage is limited to that font. Hand-drawn seeds/clean mode, arrow binding geometry and wrapping are shared with the browser. An HTTP disconnect does not cancel/replay the durable render; GET the same retained ID. On service restart, an in-progress render becomes failed, never silently retried. Same UUID/same request returns retained status; different reuse is 409. A failed export publishes no partial artifacts.

Limits: one render at a time (busy 429 starts none); 12-second worker deadline, 6-second JS interrupt budget/64 MiB JS memory, 8-megapixel PNG and at most 8192 pixels per side, 8 MiB/artifact and 12 MiB worker input (including bounded stored PNG data). Unix workers additionally have 8 CPU-second/512 MiB address-space limits. No public renderer port or daemon. The 128 KiB HTTP request contains IDs/options, not image data. Artifact BLOB quota is 64 MiB; at most 10,000 export identities retained. Artifacts expire after 24 hours; the next export reclaims expired bytes while retaining UUID/digest evidence. Durable attachment pins preserve internal bytes for unresolved outbox messages; public expired URLs remain unavailable. Quota pressure never evicts a pinned dependency.

From coordinator directory, a local download is:

```sh
python3 tools/cc_whiteboard.py export --board BOARD_UUID --theme dark --format all --output-dir ../.local/coordinator-whiteboards/exports
```

The helper creates a UUID-named private directory and saves intent before POST. Its JSON output includes local file paths. Directories are 0700/files 0600, symlinks are rejected, size/type/SHA-256 verified, and existing files are never overwritten. After an uncertain response use `download --export-id EXPORT_UUID --output-dir ...`; it performs GETs only. If the retained job failed/expired, review it before explicitly making a new export with a new UUID. Current `export` requires an output directory; callers needing only legacy native JSON can use the GET API.

Export/download alone is not delivery. The [approved attachment contract](../plans/0003-whiteboard-attachments.md) is implemented through exact-process preparation and the durable outbox; follow [coordinator messaging](coordinator-messaging.md#whiteboard-attachments). It accepts a managed PNG export UUID, never a sender-local file path. Prefer a short description plus one scoped image. Real remote Claude/Codex/pi image-viewing checks remain pending outward-test authorization.

## Clipboard and dropped images (CC-55 item 4)

Deployed; discover the served contract before using these routes on an older deployment. In the shared canvas paste an image with Ctrl/Cmd+V, or drop one image file at a time. Paste places it near the visible center; drop uses the pointer location. The initial drawing fits within 640×480 canvas units without upscaling. Select/move/resize, duplicate, conditional undo/redo, attribution, draft recovery and cross-client live reconciliation use ordinary element operations. Resize preserves the current aspect ratio by default; Shift permits independent width/height. Text editors/dialogs keep normal paste ownership. The browser-only prototype does not store images. Phone file drop is covered synthetically; actual iPhone clipboard behavior remains unverified.

POST raw bytes to `/whiteboards/{id}/images?revision=OBSERVED_SCENE_REV`, with the exact Origin and `Content-Type: application/octet-stream`. The board must exist and its revision is checked before decoding and again in the storage transaction; stale revision is 409. This stores a blob only and does not increment the scene revision. Response is `{id:SHA256,width:PIXELS,height:PIXELS}`. Uploads sniff PNG, JPEG, GIF and WebP regardless of supplied MIME/name; SVG, other formats, corrupt/truncated images and oversized input are rejected. Only the first decoded frame is kept. Re-encoding to RGBA PNG strips metadata, including EXIF/GPS; no original filename, MIME, URL or original bytes are retained. Metadata orientation is not reapplied. Input and normalized output are each <=4 MiB, <=8,000,000 intrinsic pixels and <=8192 per side. One off-executor decode at a time uses a 64 MiB best-effort decoder allocation limit; concurrent uploads return 429. An uncertain upload is not automatically repeated or placed; its abandoned blob expires.

Use the returned descriptor in the existing create/apply API:

```json
{"kind":"image","x":100,"y":100,"w":320,"h":240,"text":"","image":{"id":"NORMALIZED_PNG_SHA256","width":640,"height":480}}
```

Wrap this semantic drawing in an ordinary UUID upsert/operation with its actor and expected revisions. The hash must be 64 lowercase hex characters and must exist **on that board**, with exactly matching intrinsic dimensions. No URLs, local file paths or inline base64 are accepted. Image elements require empty text and the descriptor; other element kinds omit it. Position/display dimensions are separate from intrinsic pixels. PATCH accepts `image` along with geometry; all existing optimistic element/dependency checks apply. Creator/last-editor attribution belongs to the element mutation, not the upload. Read an image only via its board-scoped GET, which returns normalized `image/png`, no-store/nosniff, never redirects or resolves paths. A source image must be uploaded to the destination board before reusing its descriptor there; Keep as new board does this for image-containing drafts. Coordinator upload-helper support is not added in this slice; the raw REST operation is available within an authorized drawing task.

SQLite `whiteboard_images` stores one content-addressed PNG per board/hash (deduplicated within a board), outside scene/history JSON. Image quota is 16 MiB and 32 million intrinsic pixels per board, 64 MiB globally. The browser reuses bounded board-local object URLs with at most four image fetches at once, no persisted image bytes, and revokes URLs on switching image sources to another board. Upload/element edits, image reads and board deletion opportunistically collect blobs: live scene and retained drawing-history references survive; uploads with no such reference are removed after 24 hours. Deleted boards immediately lose their image bytes, while existing soft-deleted scene/history identity/reference metadata remains; deletion is not a claim of secure SQLite erasure. Frozen export images are self-contained and unaffected by subsequent source deletion. An image removed from the scene is retained while its history revision remains, so conditional undo works.

Browser and server PNG/SVG exports include images at stored geometry; native JSON/text carry blob references, intrinsic/display dimensions and creator/editor attribution, without copying bytes into every revision. Native JSON is not a standalone image archive; PNG/SVG exports embed the raster. The isolated server worker accepts only explicitly supplied, hash/dimension-verified stored PNGs; both arbitrary resource strings and non-allowlisted data are rejected, with no filesystem/network resolver. SVG download policy permits only embedded image data. Scoped exports load only included image references. Export images are capped at 4 MiB normalized bytes and 16 MP in aggregate across unique sources; use a smaller selection if exceeded. The existing 8 MiB per-artifact, 8 MP output and worker CPU/memory/deadline limits still apply. Rendering failures publish no partial artifacts.

## Named colors and shape fills (CC-55)

Deployed; discover the served contract before recoloring an existing board. Allowed `color` names are **ink, accent, blue, magenta, yellow, red, orange, green, teal, purple, gray**. `purple` is canonical; `violet` and arbitrary hex/CSS/URLs are not accepted. Nine named colors (red/orange/yellow/green/teal/blue/purple/magenta/gray) use deliberate semantic light/dark hue families, adjusted for each theme’s contrast, rather than inheriting arbitrary ANSI slots. Gray is neutral. Soft tints follow those actual drawing hues. `ink` and `accent` remain the theme’s original foreground/accent and are separate, visibly labeled Theme controls; they may coincide with each other or a named hue in some themes. The nine named-color swatches are measured for pairwise OKLab separation (at least0.08) as well as >=4.5:1 contrast on background and their own fill across all24 themes. Names and saved scenes are unchanged, but formerly misleading drawing hues are deliberately corrected; terminal/general UI colors stay unchanged. All drawing values map to dedicated `--cc-wb-NAME` and `--cc-wb-NAME-soft` tokens shared with browser/server palette data. This semantic correction is deployed in both browser and backend (task0066).

Optional `fill` is `"soft"` or `"none"`, accepted only on rectangle, ellipse, diamond and sticky elements. Soft tint follows the stroke’s named theme color (`--cc-wb-NAME-soft`, dedicated drawing tokens independent of terminal ANSI slots); none is transparent. Omit or set null to restore default behavior: ordinary shapes have no fill; stickies retain the original light/dark yellow fill. Changing stroke on a soft-filled object also changes its tint. Images, text, arrows and freehand strokes do not accept a fill field. No arbitrary fill hex/opacity/background fields are accepted.

Example semantic drawing: `{"kind":"rectangle","x":100,"y":100,"w":220,"h":100,"text":"Failure","color":"red","fill":"soft"}`. Wrap it in the normal upsert or PATCH, with the exact element revision and dependency guards. PATCH `changes:{color:"red",fill:"soft"}` recolors an existing box; `changes:{fill:null}` restores its default. Native JSON preserves the names; text export lists `color red; fill soft`. Shared browser/server geometry uses the same generated drawing palettes for identical named strokes/tints in both export themes; legacy sticky defaults remain unchanged. Server exports still use canonical light/dark palettes, as before; browser canvas follows the selected named theme.

The canvas offers eleven named swatches and a Shape fill selector (Default/None/Soft tint), with shape selection edits persisted through ordinary revisioned operations. On mobile open Sketch settings to reach them. The generic coordinator `cc_whiteboard.py` already passes drawing/PATCH fields through and needs no new color-specific CLI flags. Read the scene before edits, preserve UUIDs/revisions and respect human changes; implementing colors does not itself authorize recoloring live boards.

`python3 scripts/generate-theme-tokens.py` regenerates `theme-tokens.css` and `whiteboard-palettes.json` from pinned palette data. All nine named strokes meet at least4.5:1 against the theme background and their own soft fill in all24 themes; they also satisfy named hue ranges and pairwise perceptual separation. This preserves existing palette provenance and introduces no renderer dependency.

### Browser paint resilience

Unknown color names or missing/invalid palette paint values display as ink; they never become arbitrary CSS. A browser-only unsupported-paint warning does not rewrite the stored scene or weaken REST validation. If an individual object cannot be rendered, it receives an ink placeholder and a visible warning while other elements remain drawn; a subsequent successful render clears the warning. Structural scene/geometry bounds remain validated. Old pre-palette clients cannot read red/fill metadata and must reload; Whiteboard HTML sends no-store so reloads discover current hashed assets. Already-open clients are not forcibly refreshed and unsaved drafts are never discarded automatically.
