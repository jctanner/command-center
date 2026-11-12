# Bug 0031: Whiteboard red hue and stale browser scene rejection

Observed: 2026-11-12
State: fixed (deployed 2026-11-12); task0065

Reported32-element revision7 scene is intact and server PNG correct. Read-only fresh-client inspection renders all32 with no console errors in all24 themes. Several imported terminal ANSI red slots are green/blue/purple/gray; copying them into named drawing red makes the swatch misleading (confirmed across catalog). Need semantic red fallback for those themes, preserving other UI/terminal tokens and legacy drawing colors.

Replaying the pre-palette client bundle against this unchanged live scene reproduces a blank world, only five swatches and an Invalid or oversized local scene notice, with no uncaught console exception: the old browser paint whitelist rejects the scene. This reproduces the reported symptom but does not prove which bundle/theme was loaded in the human browser; theme question pending. Fresh client currently works. Whiteboard HTML lacks explicit no-store, and already open clients require reload for new code. Add no-store entrypoint, unknown-paint ink fallback without rewriting scene data, and isolate per-element draw failures. Keep private captures in ignored .local/. No board edits authorized.

Browser corrections published nondisruptively: read-only live check renders all32 objects with a visibly red swatch in all24 themes, zero console errors/writes/terminal sockets; full revision7 scene remains identical. Backend no-store header/shared resolver deployment awaits restart approval. The human-selected theme was not supplied, but every supported theme was checked.

Joint deployment approved/completed: current browser and embedded renderer use the distinct semantic palette/fallbacks, and Whiteboard HTML is no-store. Live32-object scene checked without mutations; nine distinct named swatches and labeled theme controls verified.
