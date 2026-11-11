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

For edits, `apply` accepts `{operation_id,actor,upserts:[{id,expected_revision,element:DRAWING}],deletes:[{id,revision}],dependencies:{ID:REV}}`. A drawing contains kind, x/y/w/h, text, color (ink/accent/blue/magenta/yellow), clean, seed and optional from/to/points. Use `expected_revision:null` only for a genuinely new UUID. PATCH single uses `{operation_id,actor,revision,changes:{text:"New label"},dependencies:{...}}`. Unknown fields and caller-supplied server metadata are rejected.

Only affected elements/dependencies need matching revisions. A stale overall scene revision does not block independent edits. For each changed existing element, include its observed revision; add the revisions of its bound endpoints and every arrow referencing a changed/deleted shape, plus those arrows' endpoints. Newly supplied arrow endpoints also need revisions when already present. Validate all or none. Shape deletion must detach/delete its arrows in the same batch; no surprise cascades. Deleted UUIDs cannot be reused as new creates; explicit restore requires the retained last-active revision. Binding validation still applies to restores. A successful duplicate operation returns the current scene without reapplying; the compact receipt retains the original committed revision. Same operation UUID/different intent is 409.

A human drawing request supplies edit authority; a scene read, actor label or linked ticket does not. Keep a private intent before IO. On 409 keep the draft and reconcile exact objects rather than substituting fresh revisions. On timeout/lost response check the same operation UUID, then read current scene; no automatic resend. Creating a board uses a retained board UUID, not an operation token. A 404 receipt only proves no commit was observed at that time.

## Browser sync and limits

The editor commits completed gestures/text edits after a short debounce. Visible clients poll the selected scene every 1.5 seconds; hidden workspaces pause. Unrelated changes merge while local changes are retained. Conflicts retain the local draft, with explicit server-version/new-copy choices. Uncertain saves retain an operation receipt and offer read-only checking. Per-tab draft/receipt namespaces prevent ordinary tabs from overwriting one another's pending edit records. Conditional undo/redo changes only locally touched objects and refuses incompatible newer content.

Starting bounds: 100 boards, 300 elements/board, 1 MiB serialized scene, 2 MiB write bodies, 1,500 freehand points/element and 4,800 UTF-8 bytes of text. Geometry is finite within ±100,000. Total scenes are capped at 16 MiB, recent snapshots at 32 MiB, and retained operation/element identity counts at 100,000 each. At most 100 recent drawing snapshots are listed, subject to global history pruning. Operation receipts retain hashes/revisions, not a second full transcript/scene history. Metadata edits are not drawing snapshots. Capacity failures preserve old state.

SVG/PNG/JSON can be downloaded from the browser. Server-rendered scoped exports are described below. Images/import and richer editing remain later work. Managed PNG attachments are implemented separately; see coordinator messaging, and discover the served API before use.

## Frozen server exports

POST `/whiteboards/{id}/export` with `{id:EXPORT_UUID,revision:SCENE_REV,scope:{kind:"board"},scale:1,theme:"dark"}`. Scale is .25–4; theme light/dark uses the corresponding built-in CC palette. Selection scope is `{kind:"selection",elements:[UUID,...]}`. Frame/group scopes are `{kind:"frame"|"group",id:REGION_UUID,revision:REGION_REV}`. Scene and region revisions must match the observations. Exported JSON/text/SVG include only selected members. An arrow referencing excluded shapes gets frozen absolute endpoints with those bindings removed; excluded labels/IDs/ticket references are not embedded. Selection does not implicitly include other connected shapes. Frames clip to their explicit bounds and refuse export if member geometry moved outside the frame.

Named scopes are API-level records for now. POST `/regions` with `{id,scene_revision,name,kind,elements,bounds}`; omit/null revision on create and use current region revision on edits. Frames require positive finite x/y/w/h bounds; groups omit/null bounds. GET `/regions` lists up to 100 scopes. This does not implement GUI group/frame editing or move scene elements.

The returned manifest has state rendering/ready/failed/expired, source revision/scope, included element IDs, bounds, theme/scale, dimensions and per-format URL/size/MIME/SHA-256. Ready `artifacts` contains png, svg, json and text. Download through the returned same-origin `/api/v1/whiteboard-exports/{UUID}/{format}` URLs. Native JSON is type cc-whiteboard-export and includes the scoped scene/description. Legacy GET export remains unchanged. Artifacts are no-store attachments with restrictive SVG CSP; SVG is self-contained with the shared font when labels exist, not hidden full-scene metadata or remote resources. Browser local-draft JSON remains distinct from a frozen committed export.

One resource-limited Rust subprocess embeds the exact pinned roughjs generator and shared browser geometry code; resvg rasterizes its SVG. No Node/Chromium service, JS host filesystem/network bindings, system fonts or external resource resolution. One bundled Liberation Sans font gives consistent supported glyphs and label placement; unsupported glyph coverage is limited to that font. Hand-drawn seeds/clean mode, arrow binding geometry and wrapping are shared with the browser. An HTTP disconnect does not cancel/replay the durable render; GET the same retained ID. On service restart, an in-progress render becomes failed, never silently retried. Same UUID/same request returns retained status; different reuse is 409. A failed export publishes no partial artifacts.

Limits: one render at a time (busy 429 starts none); 12-second worker deadline, 6-second JS interrupt budget/64 MiB JS memory, 8-megapixel PNG and at most 8192 pixels per side, 8 MiB/artifact and 2 MiB worker input. Unix workers additionally have 8 CPU-second/512 MiB address-space limits. No public renderer port or daemon. The 128 KiB HTTP request contains IDs/options, not image data. Artifact BLOB quota is 64 MiB; at most 10,000 export identities retained. Artifacts expire after 24 hours; the next export reclaims expired bytes while retaining UUID/digest evidence. Durable attachment pins preserve internal bytes for unresolved outbox messages; public expired URLs remain unavailable. Quota pressure never evicts a pinned dependency.

From coordinator directory, a local download is:

```sh
python3 tools/cc_whiteboard.py export --board BOARD_UUID --theme dark --format all --output-dir ../.local/coordinator-whiteboards/exports
```

The helper creates a UUID-named private directory and saves intent before POST. Its JSON output includes local file paths. Directories are 0700/files 0600, symlinks are rejected, size/type/SHA-256 verified, and existing files are never overwritten. After an uncertain response use `download --export-id EXPORT_UUID --output-dir ...`; it performs GETs only. If the retained job failed/expired, review it before explicitly making a new export with a new UUID. Current `export` requires an output directory; callers needing only legacy native JSON can use the GET API.

Export/download alone is not delivery. The [approved attachment contract](../plans/0003-whiteboard-attachments.md) is implemented through exact-process preparation and the durable outbox; follow [coordinator messaging](coordinator-messaging.md#whiteboard-attachments). It accepts a managed PNG export UUID, never a sender-local file path. Prefer a short description plus one scoped image. Real remote Claude/Codex/pi image-viewing checks remain pending outward-test authorization.
