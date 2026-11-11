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
| Native JSON and description download | GET `/whiteboards/{id}/export` |

Create: `{id:UUID,name:"Design",ticket:null}`. Metadata PATCH: `{revision:METADATA_REV,name:"Design",ticket:EXISTING_TICKET_UUID_OR_NULL}`. Always retain ticket when renaming unless unlinking is intended. Delete uses the exact scene `{revision:NUMBER}` and retains stored identity/history; it never controls agents or tickets.

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

SVG/PNG/JSON can be downloaded from the browser; REST export currently provides whole-board native JSON plus text. Server image rendering, selection/frame exports, images/import, richer editing and guarded remote attachments remain later work. Do not claim an agent can receive a local PNG on a different machine through the existing text outbox.
